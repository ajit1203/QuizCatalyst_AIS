import assert from 'node:assert/strict';
import { applyLearningEvidence, conceptLabelFromQuestion, correctRewardEvidence, defaultLearnerProfile, ensureConcept, learnerSummary, linkPrerequisites, normalizeLearnerProfile, rewardForAssessment } from '../src/learner-model.js';
import { chooseAssessmentPlan, chooseStrategy, chooseStrategyDecision, chooseTeachingAction } from '../src/teaching-policy.js';

const profile = defaultLearnerProfile();
const concept = ensureConcept(profile, conceptLabelFromQuestion('Teach me gradient descent with a hill analogy'));
linkPrerequisites(profile, concept, ['Derivatives', 'Loss functions']);
assert.equal(concept.label, 'Gradient descent');
assert.equal(concept.prerequisites.length, 2);

const tutorState = { exchangesSinceCheck: 0, preferredCheckFrequency: 'normal', pendingAssessmentType: null, pendingDifficulty: null };
const diagnostic = chooseTeachingAction({ style: 'adaptive', tutorState, concept, question: 'Teach me gradient descent', recentMessages: [], assessment: null });
assert.equal(diagnostic.action, 'diagnose');
assert.deepEqual(diagnostic.assessmentPlan, { type: 'diagnostic', difficulty: 1 });
assert.equal(diagnostic.shouldAsk, true);

applyLearningEvidence(profile, concept.id, { classification: 'correct' }, { action: 'advance', assessmentType: 'diagnostic', difficulty: 1, strategy: 'socratic' });
assert.equal(profile.concepts[concept.id].mastery, 0.545);
assert.equal(profile.rewardHistory.at(-1).reward, 0.45);
assert.equal(profile.concepts[concept.id].assessmentBreakdown.diagnostic.attempts, 1);

const recallPlan = chooseAssessmentPlan(profile.concepts[concept.id]);
assert.equal(recallPlan.type, 'recall');
applyLearningEvidence(profile, concept.id, { classification: 'correct' }, { action: 'advance', assessmentType: 'recall', difficulty: 2, strategy: 'example' });
assert.ok(profile.concepts[concept.id].mastery > 0.62);
assert.equal(profile.concepts[concept.id].strategyStats.example.successes, 1);

applyLearningEvidence(profile, concept.id, { classification: 'incorrect', misconception: 'The learning rate chooses direction.' }, { action: 'clarify', assessmentType: 'application', difficulty: 3, strategy: 'analogy' });
assert.equal(profile.concepts[concept.id].misconceptions[0].count, 1);
assert.equal(profile.concepts[concept.id].assessmentBreakdown.application.attempts, 1);
assert.ok(rewardForAssessment('correct', 'transfer') > rewardForAssessment('correct', 'recall'));
assert.ok(rewardForAssessment('correct', 'delayed') > rewardForAssessment('correct', 'application'));

profile.concepts[concept.id].nextReviewAt = new Date(Date.now() - 1000).toISOString();
assert.equal(chooseAssessmentPlan(profile.concepts[concept.id]).type, 'delayed');
const review = chooseTeachingAction({ style: 'adaptive', tutorState: { ...tutorState, exchangesSinceCheck: 0 }, concept: profile.concepts[concept.id], question: 'Continue', recentMessages: [], assessment: null });
assert.equal(review.action, 'review');
assert.equal(review.assessmentPlan.type, 'delayed');

const strategy = chooseStrategy(profile.concepts[concept.id], 'clarify', 'I am confused');
assert.ok(['example', 'analogy', 'worked-example'].includes(strategy));
const banditDecision = chooseStrategyDecision(profile.concepts[concept.id], 'clarify', 'I am confused');
assert.equal(banditDecision.mode, 'bandit');
assert.ok(banditDecision.candidates.length === 3);

applyLearningEvidence(profile, concept.id, { classification: 'correct' }, { action: 'advance', assessmentType: 'delayed', difficulty: 3, strategy: 'worked-example' });
assert.equal(profile.concepts[concept.id].successfulReviews, 1);
assert.ok(profile.concepts[concept.id].confidence >= 0.5);

const incorrectEvent = profile.rewardHistory.find(event => event.classification === 'incorrect');
const masteryBeforeCorrection = profile.concepts[concept.id].mastery;
const correction = correctRewardEvidence(profile, incorrectEvent.id, 'correct');
assert.equal(correction.event.auditStatus, 'corrected');
assert.equal(correction.event.originalClassification, 'incorrect');
assert.ok(profile.concepts[concept.id].mastery > masteryBeforeCorrection);
assert.equal(profile.concepts[concept.id].incorrectAttempts, 0);
const confirmation = correctRewardEvidence(profile, profile.rewardHistory[0].id, 'correct');
assert.equal(confirmation.event.auditStatus, 'confirmed');

const restored = normalizeLearnerProfile(JSON.parse(JSON.stringify(profile)));
const summary = learnerSummary(restored);
assert.equal(restored.version, 3);
assert.equal(summary.conceptCount, 3);
assert.equal(summary.dueReviewCount, 0);
assert.equal(restored.rewardHistory.length, 4);
assert.equal(summary.auditedRewardCount, 2);
assert.equal(summary.evaluatorAgreement, 0.5);

console.log(JSON.stringify({ ok: true, concept: restored.concepts[concept.id], summary }));
