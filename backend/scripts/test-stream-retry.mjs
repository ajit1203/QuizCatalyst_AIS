import assert from 'node:assert/strict';
import http from 'node:http';

let requests = 0;
const server = http.createServer((req, res) => {
  if (req.url !== '/chat/completions') { res.writeHead(404).end(); return; }
  requests += 1;
  if (requests === 1) {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Rate limit reached. Please try again in 10ms.' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Recovered' } }] }) + '\n\n');
  res.end('data: [DONE]\n\n');
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
process.env.LLM_PROVIDER = 'groq';
process.env.GROQ_API_KEY = 'test-key';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:' + address.port;

try {
  const { streamChat } = await import('../src/llm-provider.js?retry-test=' + Date.now());
  let output = '';
  await streamChat({ messages: [{ role: 'user', content: 'test' }], maxTokens: 20, onDelta: chunk => { output += chunk; } });
  assert.equal(requests, 2);
  assert.equal(output, 'Recovered');
  console.log(JSON.stringify({ ok: true, requests, output }));
} finally {
  await new Promise(resolve => server.close(resolve));
}
