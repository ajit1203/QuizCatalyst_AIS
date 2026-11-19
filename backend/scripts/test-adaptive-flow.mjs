const api = process.env.TEST_API || 'http://127.0.0.1:8788/api';

async function json(path, options) {
  const response = await fetch(api + path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'HTTP ' + response.status);
  return body;
}

async function send(chatId, message) {
  const response = await fetch(api + '/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chatId, message, mode: 'open', teachingStyle: 'adaptive' }),
  });
  if (!response.ok) throw new Error((await response.json()).error || 'HTTP ' + response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let answer = '';
  let doneEvent = null;
  while (true) {
    const result = await reader.read();
    pending += decoder.decode(result.value || new Uint8Array(), { stream: !result.done });
    const lines = pending.split('\n');
    pending = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === 'delta') answer += event.content;
      if (event.type === 'done') doneEvent = event;
      if (event.type === 'error') throw new Error(event.error);
    }
    if (result.done) break;
  }
  return { answer, doneEvent };
}

const created = await json('/chats', { method: 'POST' });
const chatId = created.chat.id;
const finalResponse = process.env.TEST_FINAL_RESPONSE || 'The learning rate chooses the downhill direction, while the gradient only decides how far to move.';
const expectedClassification = process.env.TEST_EXPECTED_CLASSIFICATION || 'incorrect';
const turns = [
  'Teach me gradient descent with a short hill-walking analogy. Do not use equations.',
  'So the gradient gives the uphill direction and we take a small step in the opposite direction. Is that correct?',
  'How does the learning rate fit into that analogy?',
  finalResponse,
];

const results = [];
for (let index = 0; index < turns.length; index += 1) {
  const result = await send(chatId, turns[index]);
  results.push(result);
  console.log(JSON.stringify({
    turn: index + 1,
    prompt: turns[index],
    answer: result.answer,
    askedCheck: result.doneEvent?.askedCheck,
    assessment: result.doneEvent?.assessment || null,
    tutorState: result.doneEvent?.tutorState,
  }));
}

const cadence = results.map(result => Boolean(result.doneEvent?.askedCheck));
if (JSON.stringify(cadence) !== JSON.stringify([true, false, true, false])) {
  throw new Error('Unexpected check cadence: ' + JSON.stringify(cadence));
}
if (results[3].doneEvent?.assessment?.classification !== expectedClassification) {
  throw new Error('Expected ' + expectedClassification + ' assessment, received ' + (results[3].doneEvent?.assessment?.classification || 'none'));
}
if (/\?\s*$/.test(results[3].answer.trim())) {
  throw new Error('The tutor asked another question immediately after the previous check.');
}
if (expectedClassification === 'incorrect' && !/^\s*(?:not quite|actually|no\b)/i.test(results[3].answer)) {
  throw new Error('The tutor did not clearly signal that the misconception was incorrect.');
}
if (expectedClassification === 'incorrect' && /^\s*(?:good|great|correct|yes\b)/i.test(results[3].answer)) {
  throw new Error('The tutor praised an incorrect answer.');
}
