const api = process.env.QUIZKATALYST_API || 'http://127.0.0.1:8787/api';
let materialId = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(api + path, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(path + ': ' + (data?.error || response.status));
  return data;
}

async function action(sectionIndex, actionName, extra = {}) {
  return request('/study-materials/' + materialId + '/sections/' + sectionIndex + '/actions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: actionName, ...extra }),
  });
}

try {
  const state = await request('/state');
  const document = state.documents.find(item => Number.isInteger(item.pageCount) && item.pageCount >= 3);
  assert(document, 'A modern PDF is required');
  const generated = await request('/study-materials', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ documentId: document.id, pageRange: '1-3', materialType: 'study-guide', depth: 'quick', personalized: true }),
  });
  materialId = generated.studyMaterial.id;
  assert(generated.studyMaterial.sections.length >= 2, 'The test material needs at least two sections');

  const proof = await request('/study-materials/' + materialId + '/sections/0/proof');
  assert(proof.proof.excerpts.length > 0, 'Source proof returned no excerpts');
  assert(proof.proof.excerpts.every(item => item.page >= 1 && item.page <= 3), 'Source proof escaped the selected page scope');
  assert(proof.proof.excerpts.some(item => item.highlights.length > 0), 'Source proof returned no highlighted terms');

  const understood = await action(0, 'understand');
  assert(understood.section.learning.status === 'understood', 'Understand action was not persisted');

  const confused = await action(1, 'confused');
  assert(confused.section.learning.status === 'confused', 'Confused action was not persisted');
  assert(confused.learnerProfile.concepts && Object.keys(confused.learnerProfile.concepts).length > 0, 'Confusion did not reach the learner profile');

  const adapted = await action(0, 'explain-differently', { style: 'analogy' });
  assert(adapted.section.learning.adaptiveExplanation?.explanation?.length > 40, 'Alternative explanation was not generated');
  assert(adapted.section.learning.adaptiveExplanation?.analogy?.length > 20, 'Alternative analogy was not generated');

  const checked = await action(0, 'test-me');
  const microCheck = checked.section.learning.microCheck;
  assert(microCheck?.options?.length === 4, 'Micro-check does not have four options');
  assert(Number.isInteger(microCheck.answerIndex), 'Micro-check has no correct answer');

  const answered = await action(0, 'answer-check', { answerIndex: microCheck.answerIndex });
  assert(answered.result?.correct === true, 'Correct micro-check answer was not recognized');
  assert(answered.section.learning.status === 'understood', 'Correct check did not mark the section understood');
  assert(answered.learnerProfile.rewardHistory.length > 0, 'Micro-check evidence did not reach the reward history');

  const saved = await request('/study-materials');
  const persisted = saved.studyMaterials.find(item => item.id === materialId);
  assert(persisted?.sections?.[0]?.learning?.microCheck?.classification === 'correct', 'Micro-check result did not persist');
  assert(persisted?.sections?.[1]?.learning?.status === 'confused', 'Weak-section state did not persist');

  console.log(JSON.stringify({ ok: true, proofExcerpts: proof.proof.excerpts.length, adapted: true, microCheckOptions: microCheck.options.length, rewardRecorded: true, smartReturnWeakSections: persisted.sections.filter(section => section.learning?.status === 'confused').length }));
} finally {
  if (materialId) await fetch(api + '/study-materials/' + materialId, { method: 'DELETE' }).catch(() => undefined);
}
