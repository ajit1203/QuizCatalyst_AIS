import assert from 'node:assert/strict';
import { appendLearningEvent, applyOrchestratorToDecision, buildOrchestratorSnapshot, createLearningEvent } from '../src/adaptive-orchestrator.js';
import { defaultLearnerProfile, ensureConcept, normalizeLearnerProfile } from '../src/learner-model.js';

const profile = normalizeLearnerProfile(defaultLearnerProfile());
const prerequisite = ensureConcept(profile, 'Fractions');
Object.assign(prerequisite, { attempts: 3, mastery: 0.31, confidence: 0.36, status: 'needs-review' });
const concept = ensureConcept(profile, 'Algebraic equations');
Object.assign(concept, { attempts: 2, mastery: 0.58, confidence: 0.35, status: 'developing', prerequisites: [prerequisite.id] });

let events = [];
events = appendLearningEvent(events, createLearningEvent({ source: 'canvas', type: 'canvas-exploration', conceptId: concept.id, outcome: 'neutral', strength: 'weak' }));
events = appendLearningEvent(events, createLearningEvent({ source: 'quiz', type: 'quiz-answer', conceptId: concept.id, outcome: 'positive', strength: 'strong' }));

const snapshot = buildOrchestratorSnapshot({ learnerProfile: profile, learningEvents: events, activeConceptId: concept.id });
assert.equal(snapshot.nextMove.kind, 'rebuild-prerequisite');
assert.equal(snapshot.nextMove.targetConceptId, prerequisite.id);
assert.equal(snapshot.evidence.counts.weak, 1);
assert.equal(snapshot.evidence.counts.strong, 1);
assert.equal(snapshot.guardrails.canvasIsWeakEvidence, true);

const decision = applyOrchestratorToDecision({ action: 'explain', shouldAsk: true, strategy: 'concise', reason: 'Base policy' }, snapshot, { style: 'adaptive', assessment: null });
assert.equal(decision.action, 'revisit');
assert.equal(decision.shouldAsk, false);
assert.equal(decision.strategy, 'worked-example');
assert.equal(decision.orchestratorOverride, true);

const quickDecision = applyOrchestratorToDecision({ action: 'explain', shouldAsk: false, strategy: 'concise' }, snapshot, { style: 'quick', assessment: null });
assert.equal(quickDecision.action, 'explain');
assert.equal(quickDecision.orchestratorOverride, undefined);

const beforeMastery = concept.mastery;
buildOrchestratorSnapshot({ learnerProfile: profile, learningEvents: [...events, createLearningEvent({ source: 'canvas', conceptId: concept.id, outcome: 'positive', strength: 'weak' })], activeConceptId: concept.id });
assert.equal(concept.mastery, beforeMastery, 'Orchestrator telemetry must not mutate mastery.');

console.log(JSON.stringify({ ok: true, nextMove: snapshot.nextMove.kind, evidence: snapshot.evidence.counts, override: decision.action }));
