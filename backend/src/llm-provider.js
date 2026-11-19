import 'dotenv/config';

const preferredProvider = String(process.env.LLM_PROVIDER || 'groq').toLowerCase();
const groqApiKey = process.env.GROQ_API_KEY || '';
const groqBaseUrl = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const groqTutorModel = process.env.GROQ_TUTOR_MODEL || 'openai/gpt-oss-120b';
const groqEvaluatorModel = process.env.GROQ_EVALUATOR_MODEL || 'openai/gpt-oss-20b';

// LOCAL LLM FALLBACK: intentionally retained for the future setup screen where
// users can choose private Ollama inference instead of a cloud API. During the
// Groq testing phase it is used only when GROQ_API_KEY is not configured, or
// when LLM_PROVIDER=ollama is explicitly selected.
const ollamaBaseUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const ollamaTutorModel = process.env.OLLAMA_MODEL || 'phi3:latest';
const ollamaEvaluatorModel = process.env.OLLAMA_EVALUATOR_MODEL || 'phi3:latest';
const ollamaIndexModel = process.env.OLLAMA_INDEX_MODEL || 'llama3.2:3b';

const activeProvider = preferredProvider === 'ollama' ? 'ollama' : groqApiKey ? 'groq' : 'ollama';
const fallbackReason = preferredProvider === 'groq' && !groqApiKey ? 'GROQ_API_KEY is not configured; using the documented Ollama fallback.' : null;

function roleModel(role) {
  if (activeProvider === 'groq') return role === 'evaluator' ? groqEvaluatorModel : groqTutorModel;
  return role === 'evaluator' ? ollamaEvaluatorModel : ollamaTutorModel;
}

function groqHeaders() {
  return { authorization: 'Bearer ' + groqApiKey, 'content-type': 'application/json' };
}

async function parseError(response) {
  const text = await response.text().catch(() => '');
  try { return JSON.parse(text)?.error?.message || text || 'HTTP ' + response.status; }
  catch { return text || 'HTTP ' + response.status; }
}

function retryDelayMs(response, errorMessage = '') {
  const retryHeader = response.headers.get('retry-after');
  const retrySeconds = Number(retryHeader);
  if (Number.isFinite(retrySeconds) && retrySeconds > 0) return Math.min(65000, Math.max(500, retrySeconds * 1000 + 350));
  if (retryHeader) {
    const retryDate = Date.parse(retryHeader);
    if (Number.isFinite(retryDate)) return Math.min(65000, Math.max(500, retryDate - Date.now() + 350));
  }
  const retryMatch = String(errorMessage).match(/try again in\s+([\d.]+)\s*(ms|s(?:ec(?:ond)?s?)?)/i);
  if (retryMatch) {
    const amount = Number(retryMatch[1]);
    const milliseconds = retryMatch[2].toLowerCase() === 'ms' ? amount : amount * 1000;
    return Math.min(65000, Math.max(500, milliseconds + 350));
  }
  return 1000;
}

export async function completeChat({ messages, role = 'tutor', json = false, schema = null, signal, maxTokens } = {}) {
  const model = roleModel(role);
  if (activeProvider === 'groq') {
    const responseFormat = schema ? { type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: schema.definition } } : json ? { type: 'json_object' } : undefined;
    const requestBody = JSON.stringify({ model, messages, stream: false, temperature: role === 'evaluator' ? 0.05 : 0.2, max_completion_tokens: maxTokens || (role === 'evaluator' ? 600 : 700), ...(responseFormat ? { response_format: responseFormat } : {}) });
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(groqBaseUrl + '/chat/completions', { method: 'POST', headers: groqHeaders(), signal, body: requestBody });
      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        if (content) return { content, usage: data.usage || null, model, provider: 'groq' };
        lastError = new Error('Groq returned an empty completion.');
      } else {
        const errorMessage = await parseError(response);
        lastError = new Error('Groq: ' + errorMessage);
        if (response.status < 500 && response.status !== 429) throw lastError;
        if (response.status === 429 && attempt < 5) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs(response, errorMessage)));
          continue;
        }
      }
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw lastError || new Error('Groq completion failed.');
  }

  // LOCAL LLM FALLBACK: Ollama's native endpoint remains isolated here so it
  // can later be exposed as an equal user-selectable provider without touching
  // the tutoring, learner-model, or reward code.
  const response = await fetch(ollamaBaseUrl + '/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ model, stream: false, ...(json ? { format: 'json' } : {}), messages, options: { temperature: role === 'evaluator' ? 0.1 : 0.25, num_predict: maxTokens || (role === 'evaluator' ? 240 : 700) } }),
  });
  if (!response.ok) throw new Error('Ollama: ' + await parseError(response));
  const data = await response.json();
  return { content: data.message?.content || '', usage: null, model, provider: 'ollama' };
}

export async function completeIndexChat({ messages, schema, signal, maxTokens = 5000 } = {}) {
  if (String(process.env.INDEX_PROVIDER || 'ollama').toLowerCase() !== 'groq') {
    try {
      const response = await fetch(ollamaBaseUrl + '/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal,
        body: JSON.stringify({ model: ollamaIndexModel, stream: false, messages, ...(schema ? { format: schema.definition } : { format: 'json' }), options: { temperature: 0.05, num_predict: maxTokens, num_ctx: 65536 } }),
      });
      if (!response.ok) throw new Error('Ollama indexer: ' + await parseError(response));
      const data = await response.json();
      const content = data.message?.content || '';
      if (!content) throw new Error('Ollama indexer returned an empty completion.');
      return { content, usage: null, model: ollamaIndexModel, provider: 'ollama' };
    } catch (error) {
      if (String(process.env.INDEX_CLOUD_FALLBACK || '').toLowerCase() !== 'true') throw new Error(error.message + ' Set INDEX_PROVIDER=groq only for sources that fit your cloud rate limits.');
      console.warn('Local curriculum indexer unavailable; falling back to configured evaluator:', error.message);
    }
  }
  return completeChat({ messages, role: 'evaluator', json: true, schema, signal, maxTokens });
}

export async function streamChat({ messages, role = 'tutor', signal, maxTokens = 440, stop = [], onDelta } = {}) {
  const model = roleModel(role);
  if (activeProvider === 'groq') {
    const requestBody = JSON.stringify({ model, messages, stream: true, temperature: 0.18, max_completion_tokens: maxTokens, ...(stop.length ? { stop: stop.slice(0, 4) } : {}) });
    let response = null;
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await fetch(groqBaseUrl + '/chat/completions', { method: 'POST', headers: groqHeaders(), signal, body: requestBody });
      if (response.ok) break;
      const errorMessage = await parseError(response);
      lastError = new Error('Groq: ' + errorMessage);
      if (response.status !== 429 && response.status < 500) throw lastError;
      if (attempt < 5) {
        await new Promise(resolve => setTimeout(resolve, response.status === 429 ? retryDelayMs(response, errorMessage) : 700));
        continue;
      }
    }
    if (!response?.ok) throw lastError || new Error('Groq streaming request failed.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = pending.split('\n\n');
      pending = events.pop() || '';
      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          const data = JSON.parse(payload);
          if (data.error) throw new Error(data.error.message || 'Groq streaming error');
          onDelta(data.choices?.[0]?.delta?.content || '');
        }
      }
      if (done) break;
    }
    return;
  }

  // LOCAL LLM FALLBACK: native Ollama NDJSON streaming implementation.
  const response = await fetch(ollamaBaseUrl + '/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ model, stream: true, messages, options: { temperature: 0.18, num_predict: maxTokens, ...(stop.length ? { stop } : {}) } }),
  });
  if (!response.ok) throw new Error('Ollama: ' + await parseError(response));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const consume = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.error) throw new Error(event.error);
    onDelta(event.message?.content || '');
  };
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split('\n');
    pending = lines.pop() || '';
    lines.forEach(consume);
    if (done) break;
  }
  if (pending.trim()) consume(pending);
}

export async function providerHealth() {
  if (activeProvider === 'groq') {
    const response = await fetch(groqBaseUrl + '/models', { headers: groqHeaders() });
    if (!response.ok) throw new Error(await parseError(response));
    const data = await response.json();
    return { ok: true, provider: 'groq', preferredProvider, fallbackReason, activeModel: groqTutorModel, evaluatorModel: groqEvaluatorModel, models: (data.data || []).map(item => item.id) };
  }
  const response = await fetch(ollamaBaseUrl + '/api/tags');
  if (!response.ok) throw new Error(await parseError(response));
  const data = await response.json();
  return { ok: true, provider: 'ollama', preferredProvider, fallbackReason, activeModel: ollamaTutorModel, evaluatorModel: ollamaEvaluatorModel, models: (data.models || []).map(item => item.name) };
}

export const providerConfig = { activeProvider, preferredProvider, fallbackReason, tutorModel: roleModel('tutor'), evaluatorModel: roleModel('evaluator') };
