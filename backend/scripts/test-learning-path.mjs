import assert from 'node:assert/strict';
import { defaultLearnerProfile, ensureConcept } from '../src/learner-model.js';
import { createChunkBatches, deduplicateCandidates, indexedSourceChunks, learningPathProgress, normalizeLearningPath } from '../src/learning-path.js';

const path = normalizeLearningPath({ title: 'Calculus foundations', description: 'A grounded route.', concepts: [
  { id: 'limits', label: 'Limits', summary: 'Approaching values.', prerequisiteIds: [], sourceTitle: 'notes.pdf', sourcePage: 2 },
  { id: 'derivatives', label: 'Derivatives', summary: 'Rates of change.', prerequisiteIds: ['limits'], sourceTitle: 'notes.pdf', sourcePage: 8 },
] }, { documentIds: ['doc-1'], sourceTitles: ['notes.pdf'] });
assert.equal(path.concepts.length, 2);
assert.equal(path.concepts[1].prerequisiteIds[0], 'limits');

const indexed = indexedSourceChunks([{ documentId: 'doc-1', name: 'notes.pdf', chunks: Array.from({ length: 5 }, (_, index) => ({ content: 'Chunk ' + index, pageStart: index + 1 })) }]);
assert.equal(indexed[4].chunkId, 'd1-c5');
assert.equal(createChunkBatches(indexed, { maxChars: 1000, maxChunks: 2 }).length, 3);
const deduped = deduplicateCandidates([
  { label: 'Resonance', summary: 'Short', importance: 3, chunkIds: ['d1-c1'], sourceTitle: 'notes.pdf', sourcePage: 1 },
  { label: 'Resonance', summary: 'A longer and clearer summary', importance: 5, chunkIds: ['d1-c2'], sourceTitle: 'notes.pdf', sourcePage: 2 },
]);
assert.equal(deduped.length, 1);
assert.equal(deduped[0].importance, 5);
assert.deepEqual(deduped[0].chunkIds, ['d1-c1', 'd1-c2']);

const profile = defaultLearnerProfile();
let progress = learningPathProgress(path, profile);
assert.equal(progress.recommendation.action, 'diagnostic');
assert.equal(progress.recommendation.label, 'Limits');

const limits = ensureConcept(profile, 'Limits');
limits.mastery = 0.8; limits.confidence = 0.5; limits.status = 'mastered'; limits.attempts = 3;
progress = learningPathProgress(path, profile);
assert.equal(progress.recommendation.label, 'Derivatives');
assert.equal(progress.completion, 50);

limits.nextReviewAt = new Date(Date.now() - 1000).toISOString();
progress = learningPathProgress(path, profile);
assert.equal(progress.recommendation.action, 'review');
assert.equal(progress.recommendation.label, 'Limits');
console.log('learning path tests passed');
