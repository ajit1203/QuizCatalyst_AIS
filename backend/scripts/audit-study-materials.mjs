const api = process.env.QUIZKATALYST_API || 'http://127.0.0.1:8787/api';
const createdIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(api + path, options);
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}

function validateMaterial(material, testCase) {
  assert(material && typeof material === 'object', testCase.name + ': missing material');
  assert(material.materialType === testCase.materialType, testCase.name + ': wrong material type');
  assert(material.depth === testCase.depth, testCase.name + ': wrong depth');
  assert(material.personalized === testCase.personalized, testCase.name + ': wrong personalization flag');
  assert(typeof material.title === 'string' && material.title.length > 3, testCase.name + ': missing title');
  assert(typeof material.overview === 'string' && material.overview.length > 30, testCase.name + ': missing overview');
  assert(Number.isInteger(material.estimatedMinutes) && material.estimatedMinutes > 0, testCase.name + ': invalid study time');
  assert(Array.isArray(material.learningObjectives) && material.learningObjectives.length > 0, testCase.name + ': missing objectives');
  assert(Array.isArray(material.sections) && material.sections.length > 0, testCase.name + ': missing sections');
  assert(Array.isArray(material.quickReference) && material.quickReference.length > 0, testCase.name + ': missing quick reference');
  assert(Array.isArray(material.flashcards) && material.flashcards.length > 0, testCase.name + ': missing flashcards');
  assert(Array.isArray(material.reviewPlan) && material.reviewPlan.length > 0, testCase.name + ': missing review plan');
  if (testCase.materialType === 'flashcards') assert(material.flashcards.length >= 10, testCase.name + ': flashcard deck is too small');
  if (testCase.materialType === 'cheat-sheet') assert(material.quickReference.length >= 5, testCase.name + ': cheat sheet reference is too small');
  if (testCase.pages) {
    const allowed = new Set(testCase.pages);
    const citations = [...material.sections, ...material.quickReference, ...material.flashcards].map(item => item.sourcePage).filter(page => page > 0);
    assert(citations.length > 0, testCase.name + ': missing page citations');
    assert(citations.every(page => allowed.has(page)), testCase.name + ': citation escaped selected pages');
  }
}

const stateResult = await jsonRequest('/state');
assert(stateResult.response.ok, 'Could not load application state');
const modernPdf = stateResult.data.documents.find(document => Number.isInteger(document.pageCount) && document.pageCount >= 9);
assert(modernPdf, 'A PDF with at least nine pages is required for the integration audit');
const legacyPdf = stateResult.data.documents.find(document => !document.pageCount && /\.pdf$/i.test(document.name));

const cases = [
  { name: 'complete quick guide', materialType: 'study-guide', depth: 'quick', personalized: true, pageRange: '' },
  { name: 'balanced revision notes', materialType: 'revision-notes', depth: 'balanced', personalized: false, pageRange: '1-3', pages: [1, 2, 3] },
  { name: 'deep cheat sheet', materialType: 'cheat-sheet', depth: 'deep', personalized: true, pageRange: '4-6', pages: [4, 5, 6] },
  { name: 'balanced flashcards', materialType: 'flashcards', depth: 'balanced', personalized: false, pageRange: '7-9', pages: [7, 8, 9] },
];

try {
  for (const testCase of cases) {
    const started = Date.now();
    const { response, data } = await jsonRequest('/study-materials', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: modernPdf.id, pageRange: testCase.pageRange, materialType: testCase.materialType, depth: testCase.depth, personalized: testCase.personalized }),
    });
    assert(response.status === 201, testCase.name + ': generation failed: ' + (data?.error || response.status));
    validateMaterial(data.studyMaterial, testCase);
    createdIds.push(data.studyMaterial.id);
    console.log(JSON.stringify({ test: testCase.name, ok: true, ms: Date.now() - started, sections: data.studyMaterial.sections.length, references: data.studyMaterial.quickReference.length, flashcards: data.studyMaterial.flashcards.length, scope: data.studyMaterial.scope }));
  }

  const saved = await jsonRequest('/study-materials');
  assert(saved.response.ok, 'Saved-material retrieval failed');
  const savedIds = new Set(saved.data.studyMaterials.map(material => material.id));
  assert(createdIds.every(id => savedIds.has(id)), 'One or more generated materials were not persisted');
  console.log(JSON.stringify({ test: 'saved library persistence', ok: true, count: createdIds.length }));

  const invalidRange = await jsonRequest('/study-materials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId: modernPdf.id, pageRange: '0-9999', materialType: 'study-guide', depth: 'quick' }) });
  assert(invalidRange.response.status === 400, 'Invalid page ranges must return 400');
  console.log(JSON.stringify({ test: 'invalid page range rejection', ok: true }));

  const missingSource = await jsonRequest('/study-materials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId: 'missing-document', materialType: 'study-guide' }) });
  assert(missingSource.response.status === 400, 'Missing sources must return 400');
  console.log(JSON.stringify({ test: 'missing source rejection', ok: true }));

  if (legacyPdf) {
    const legacyRange = await jsonRequest('/study-materials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId: legacyPdf.id, pageRange: '1-2', materialType: 'study-guide', depth: 'quick' }) });
    assert(legacyRange.response.status === 400, 'Legacy PDFs must reject exact page selection');
    console.log(JSON.stringify({ test: 'legacy PDF page rejection', ok: true }));
  }
} finally {
  for (const id of createdIds) {
    const removed = await jsonRequest('/study-materials/' + id, { method: 'DELETE' });
    if (!removed.response.ok && removed.response.status !== 404) console.error('Could not remove audit material ' + id);
  }
  console.log(JSON.stringify({ cleanup: true, removed: createdIds.length }));
}
