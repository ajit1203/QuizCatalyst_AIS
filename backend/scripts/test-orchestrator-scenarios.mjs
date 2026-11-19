import assert from 'node:assert/strict';
import { applyOrchestratorToDecision, buildOrchestratorSnapshot, createLearningEvent } from '../src/adaptive-orchestrator.js';
import { defaultLearnerProfile, ensureConcept, normalizeLearnerProfile } from '../src/learner-model.js';
import { chooseTeachingAction } from '../src/teaching-policy.js';

const now = new Date('2026-11-01T12:00:00.000Z');
const assessed = (type, attempts, correct = 0) => ({ attempts, correct });

function profileWithConcept(overrides = {}, prerequisites = []) {
  const profile = normalizeLearnerProfile(defaultLearnerProfile());
  const concept = ensureConcept(profile, 'Target concept');
  Object.assign(concept, {
    attempts: 2, mastery: 0.6, confidence: 0.4, status: 'developing', difficultyLevel: 2,
    assessmentBreakdown: {
      diagnostic: assessed('diagnostic', 1, 1), recall: assessed('recall', 1, 1), application: assessed('application', 1, 1),
      transfer: assessed('transfer', 0, 0), misconception: assessed('misconception', 0, 0), delayed: assessed('delayed', 0, 0),
    },
    prerequisites,
    ...overrides,
  });
  return { profile, concept };
}

function snapshotFor(overrides = {}, events = [], prerequisites = []) {
  const { profile, concept } = profileWithConcept(overrides, prerequisites);
  return { profile, concept, snapshot: buildOrchestratorSnapshot({ learnerProfile: profile, learningEvents: events, activeConceptId: concept.id }) };
}

const scenarios = [];
function scenario(name, expected, create) {
  const value = create();
  assert.equal(value.snapshot.nextMove.kind, expected, name);
  scenarios.push({ name, nextMove: value.snapshot.nextMove.kind });
  return value;
}

const empty = buildOrchestratorSnapshot({ learnerProfile: defaultLearnerProfile(), learningEvents: [] });
assert.equal(empty.nextMove.kind, 'discover');
scenarios.push({ name: 'empty learner', nextMove: empty.nextMove.kind });

scenario('new concept', 'diagnostic', () => snapshotFor({ attempts: 0, confidence: 0.08, status: 'unassessed', mastery: 0.5 }));
scenario('low mastery', 'guided-practice', () => snapshotFor({ mastery: 0.42, confidence: 0.38, status: 'learning' }));
scenario('developing concept', 'apply', () => snapshotFor({ mastery: 0.67, confidence: 0.48, status: 'developing' }));
scenario('strong familiar performance', 'transfer', () => snapshotFor({ mastery: 0.86, confidence: 0.66, status: 'mastered', assessmentBreakdown: { diagnostic: assessed('', 1, 1), recall: assessed('', 2, 2), application: assessed('', 2, 2), transfer: assessed('', 0, 0), misconception: assessed('', 0, 0), delayed: assessed('', 1, 1) } }));
scenario('transfer demonstrated', 'advance', () => snapshotFor({ mastery: 0.9, confidence: 0.74, status: 'mastered', assessmentBreakdown: { diagnostic: assessed('', 1, 1), recall: assessed('', 2, 2), application: assessed('', 2, 2), transfer: assessed('', 1, 1), misconception: assessed('', 0, 0), delayed: assessed('', 1, 1) } }));
scenario('spaced review due', 'spaced-review', () => snapshotFor({ nextReviewAt: new Date(now.getTime() - 1000).toISOString(), mastery: 0.78, confidence: 0.58 }));
scenario('known misconception', 'repair-misconception', () => snapshotFor({ misconceptions: [{ text: 'Confuses cause and effect.', count: 1, lastSeenAt: now.toISOString() }] }));

{
  const profile = normalizeLearnerProfile(defaultLearnerProfile());
  const prerequisite = ensureConcept(profile, 'Required foundation');
  Object.assign(prerequisite, { attempts: 3, mastery: 0.3, confidence: 0.35, status: 'needs-review' });
  const concept = ensureConcept(profile, 'Target concept');
  Object.assign(concept, { attempts: 2, mastery: 0.65, confidence: 0.45, status: 'developing', prerequisites: [prerequisite.id] });
  const snapshot = buildOrchestratorSnapshot({ learnerProfile: profile, learningEvents: [], activeConceptId: concept.id });
  assert.equal(snapshot.nextMove.kind, 'rebuild-prerequisite');
  assert.equal(snapshot.nextMove.targetConceptId, prerequisite.id);
  scenarios.push({ name: 'weak prerequisite', nextMove: snapshot.nextMove.kind });
}

{
  const events = Array.from({ length: 12 }, (_, index) => createLearningEvent({ source: 'canvas', type: 'node-select', conceptId: 'target-concept', outcome: index % 2 ? 'positive' : 'neutral', strength: 'weak' }));
  const value = snapshotFor({ mastery: 0.67, confidence: 0.48 }, events);
  assert.equal(value.snapshot.nextMove.kind, 'apply');
  assert.equal(value.snapshot.evidence.counts.weak, 12);
  assert.equal(value.concept.mastery, 0.67, 'Canvas activity must not mutate mastery.');
  scenarios.push({ name: 'canvas-only activity', nextMove: value.snapshot.nextMove.kind });
}

{
  const negative = createLearningEvent({ source: 'quiz', type: 'quiz-answer', conceptId: 'target-concept', outcome: 'negative', strength: 'strong' });
  const value = snapshotFor({ misconceptions: [], incorrectAttempts: 0 }, [negative]);
  assert.equal(value.snapshot.nextMove.kind, 'repair-misconception');
  assert.equal(value.snapshot.learningState.momentum, 'struggling');
  scenarios.push({ name: 'negative strong evidence', nextMove: value.snapshot.nextMove.kind });
}

{
  const value = snapshotFor({ misconceptions: [{ text: 'Persistent misconception', count: 1, lastSeenAt: now.toISOString() }] });
  const base = { action: 'check', shouldAsk: true, strategy: 'socratic', reason: 'Base cadence' };
  const adapted = applyOrchestratorToDecision(base, value.snapshot, { style: 'adaptive', assessment: null });
  assert.equal(adapted.action, 'clarify');
  assert.equal(adapted.shouldAsk, false, 'Misconception repair must explain before retesting.');
  const quick = applyOrchestratorToDecision(base, value.snapshot, { style: 'quick', assessment: null });
  assert.equal(quick.action, 'check', 'Quick Answer must not be overridden.');
  const assessedTurn = applyOrchestratorToDecision(base, value.snapshot, { style: 'adaptive', assessment: { classification: 'incorrect' } });
  assert.equal(assessedTurn.action, 'check', 'The current assessed response remains authoritative for this turn.');
  scenarios.push({ name: 'cadence guardrails', nextMove: adapted.action });
}

{
  const { concept } = profileWithConcept({ attempts: 0, confidence: 0.08, status: 'unassessed' });
  const tutorState = { preferredCheckFrequency: 'normal', pendingAssessmentType: null, pendingDifficulty: null, exchangesSinceCheck: 3 };
  const quick = chooseTeachingAction({ style: 'quick', tutorState, concept, question: 'Teach me this topic', recentMessages: [], assessment: null });
  assert.equal(quick.shouldAsk, false);
  const adaptive = chooseTeachingAction({ style: 'adaptive', tutorState, concept, question: 'Teach me this topic', recentMessages: [], assessment: null });
  assert.equal(adaptive.action, 'diagnose');
  assert.equal(adaptive.shouldAsk, true);
  scenarios.push({ name: 'quick versus adaptive', nextMove: quick.shouldAsk ? 'unexpected-check' : 'no-check' });
}

{
  const { concept } = profileWithConcept({ attempts: 3, mastery: 0.62, confidence: 0.45 });
  const tutorState = { preferredCheckFrequency: 'normal', pendingAssessmentType: null, pendingDifficulty: null, exchangesSinceCheck: 2 };
  const reduced = chooseTeachingAction({ style: 'adaptive', tutorState, concept, question: 'Please ask fewer questions while teaching this.', recentMessages: [], assessment: null });
  assert.equal(reduced.preference, 'low');
  assert.equal(reduced.shouldAsk, false);
  const consecutive = chooseTeachingAction({ style: 'guided', tutorState, concept, question: 'Continue', recentMessages: [{ role: 'assistant', content: 'Can you apply that idea?' }], assessment: null });
  assert.equal(consecutive.shouldAsk, false, 'The tutor must not ask checks on consecutive turns.');
  scenarios.push({ name: 'question-frequency controls', nextMove: reduced.shouldAsk ? 'unexpected-check' : 'reduced-cadence' });
}

console.log(JSON.stringify({ ok: true, scenarioCount: scenarios.length, scenarios }, null, 2));
