const models = process.argv.slice(2);
if (!models.length) throw new Error('Pass at least one Ollama model name.');

const prompt = [
  { role: 'system', content: 'You are an accurate, concise tutor. Use a hill-walking analogy to explain gradient descent in 120-180 words. Include exactly one correct numerical example using f(x)=x^2, start at x=2, and learning rate 0.1. End with one specific comprehension question. Use at most one heading.' },
  { role: 'user', content: 'Teach me gradient descent. I understand basic algebra but not calculus.' },
];

for (const model of models) {
  const started = performance.now();
  try {
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ model, stream: false, messages: prompt, keep_alive: 0, options: { temperature: 0.2, num_predict: 320 } }),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    const content = data.message?.content || '';
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    const expectedMath = /x\s*=\s*1\.6|1\.6/.test(content);
    const endsWithQuestion = /\?\s*$/.test(content.trim());
    console.log(JSON.stringify({ model, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), words, expectedMath, endsWithQuestion, content }));
  } catch (error) {
    console.log(JSON.stringify({ model, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), error: error.message }));
  }
}
