import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const temp = await mkdtemp(join(tmpdir(), 'quizkatalyst-orchestrator-api-'));
const dbFile = join(temp, 'data.json');
const port = 18967;
const api = 'http://127.0.0.1:' + port + '/api';
const now = new Date().toISOString();
const quiz = {
  id: 'scenario-quiz', title: 'Scenario quiz', difficulty: 'medium', submittedAt: null,
  questions: [
    { id: 'q1', concept: 'Compound interest', question: 'What compounds?', options: ['Principal only', 'Principal and accumulated interest', 'Fees', 'Nothing'], answerIndex: 1, explanation: 'Interest is applied to principal and accumulated interest.' },
    { id: 'q2', concept: 'Inflation', question: 'What happens to purchasing power?', options: ['Usually falls', 'Always doubles', 'Never changes', 'Becomes infinite'], answerIndex: 0, explanation: 'With positive inflation, the same nominal amount usually buys less.' },
  ],
  generatedAt: now,
};
await writeFile(dbFile, JSON.stringify({ documents: [], chats: [], learnerProfile: { version: 3, learnerId: 'test', concepts: {}, rewardHistory: [], updatedAt: null }, learningPaths: [], studyMaterials: [], learningEvents: [], orchestratorHistory: [], quizzes: [quiz] }));

const server = spawn(process.execPath, ['src/server.js'], { cwd: new URL('../', import.meta.url), env: { ...process.env, PORT: String(port), QUIZKATALYST_DB_FILE: dbFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverError = '';
server.stderr.on('data', chunk => { serverError += chunk.toString(); });

async function request(path, options) {
  const response = await fetch(api + path, options);
  const body = await response.json();
  return { response, body };
}

try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(api)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const submission = await request('/quiz/scenario-quiz/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers: { q1: 0, q2: 0 } }) });
  assert.equal(submission.response.status, 200, JSON.stringify(submission.body));
  assert.equal(submission.body.score, 1);
  assert.equal(submission.body.questionCount, 2);
  assert.equal(submission.body.orchestrator.nextMove.kind, 'repair-misconception');
  assert.equal(submission.body.orchestrator.evidence.counts.strong, 1, 'The active weakest concept should have one strong event.');
  assert.equal(Object.keys(submission.body.learnerProfile.concepts).length, 2);

  const duplicate = await request('/quiz/scenario-quiz/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers: { q1: 1, q2: 0 } }) });
  assert.equal(duplicate.response.status, 409);

  const conceptId = submission.body.orchestrator.activeConcept.id;
  const feedback = await request('/orchestrator/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ helpful: false, conceptId }) });
  assert.equal(feedback.response.status, 200);
  assert.equal(feedback.body.orchestrator.evidence.counts.moderate, 1);

  const persisted = JSON.parse(await readFile(dbFile, 'utf8'));
  assert.equal(persisted.learningEvents.length, 3);
  assert.equal(persisted.quizzes[0].submittedAt !== null, true);
  assert.equal(persisted.orchestratorHistory.length, 1);
  console.log(JSON.stringify({ ok: true, quizScore: submission.body.score, nextMove: submission.body.orchestrator.nextMove.kind, duplicateStatus: duplicate.response.status, eventCount: persisted.learningEvents.length }));
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
  await rm(temp, { recursive: true, force: true });
}

if (serverError) process.stderr.write(serverError);
