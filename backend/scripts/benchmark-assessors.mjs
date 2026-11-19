const models = process.argv.slice(2);
if (!models.length) throw new Error('Pass at least one Ollama model name.');

const system = { role: 'system', content: 'You are a strict educational answer grader. Compare every claim in the student response with the reference explanation. Watch for swapped roles, reversed causes, negation, and correct keywords used in the wrong relationship. Never infer correctness from keyword overlap. For incorrect answers, state the correct central relationship using the reference. Return JSON only: {"classification":"correct|partial|incorrect|unclear","misconception":"one precise sentence","correction":"one precise sentence","confidence":0.0}.' };
const cases = [
  { name: 'reversed', response: 'The learning rate chooses the downhill direction, while the gradient only decides how far to move.' },
  { name: 'correct', response: 'The gradient gives the uphill direction, so the negative gradient gives the downhill direction. The learning rate sets how large each step is.' },
];

for (const model of models) for (const testCase of cases) {
  const started = performance.now();
  try {
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ model, stream: false, format: 'json', messages: [system, { role: 'user', content: 'Reference explanation: The gradient gives the uphill direction; the negative gradient gives the downhill direction. The learning rate determines step size.\nTutor check: Explain the key idea in your own words.\nStudent response: ' + testCase.response }], keep_alive: 0, options: { temperature: 0, num_predict: 180 } }),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    console.log(JSON.stringify({ model, case: testCase.name, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), result: data.message?.content || '' }));
  } catch (error) {
    console.log(JSON.stringify({ model, case: testCase.name, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), error: error.message }));
  }
}
