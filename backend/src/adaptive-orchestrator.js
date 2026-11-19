import { isReviewDue, normalizeLearnerProfile } from './learner-model.js';

const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const EVENT_SOURCES = ['chat', 'quiz', 'canvas', 'material', 'chemistry', 'review', 'feedback'];
const EVENT_STRENGTHS = ['weak', 'moderate', 'strong'];
const OUTCOMES = ['positive', 'partial', 'negative', 'neutral'];

const strengthWeight = strength => ({ weak: 0.18, moderate: 0.55, strong: 1 }[strength] || 0.18);
const outcomeValue = outcome => ({ positive: 1, partial: 0.35, negative: -1, neutral: 0 }[outcome] || 0);

export function createLearningEvent(input = {}) {
  const at = typeof input.at === 'string' && !Number.isNaN(Date.parse(input.at)) ? input.at : new Date().toISOString();
  return {
    id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
    source: EVENT_SOURCES.includes(input.source) ? input.source : 'chat',
    type: String(input.type || 'learning-signal').trim().slice(0, 64),
    conceptId: typeof input.conceptId === 'string' ? input.conceptId.slice(0, 80) : null,
    conceptLabel: typeof input.conceptLabel === 'string' ? input.conceptLabel.trim().slice(0, 100) : null,
    outcome: OUTCOMES.includes(input.outcome) ? input.outcome : 'neutral',
    strength: EVENT_STRENGTHS.includes(input.strength) ? input.strength : 'weak',
    strategy: typeof input.strategy === 'string' ? input.strategy.slice(0, 48) : null,
    chatId: typeof input.chatId === 'string' ? input.chatId.slice(0, 80) : null,
    detail: typeof input.detail === 'string' ? input.detail.trim().slice(0, 280) : '',
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {},
    at,
  };
}

export function normalizeLearningEvents(events) {
  return (Array.isArray(events) ? events : []).map(createLearningEvent).slice(-600);
}

export function appendLearningEvent(events, event) {
  return [...normalizeLearningEvents(events), createLearningEvent(event)].slice(-600);
}

function bestStrategy(concept) {
  const ranked = Object.entries(concept?.strategyStats || {})
    .filter(([, stats]) => Number(stats?.uses) > 0)
    .map(([strategy, stats]) => ({ strategy, score: Number(stats.reward || 0) / Math.max(1, Number(stats.uses) || 0), uses: Number(stats.uses) || 0 }))
    .sort((a, b) => b.score - a.score || b.uses - a.uses);
  return ranked[0]?.strategy || null;
}

function conceptEvents(events, conceptId) {
  return normalizeLearningEvents(events).filter(event => !conceptId || event.conceptId === conceptId);
}

function evidenceSummary(events, conceptId) {
  const relevant = conceptEvents(events, conceptId);
  const counts = { weak: 0, moderate: 0, strong: 0 };
  let weightedOutcome = 0;
  let totalWeight = 0;
  relevant.slice(-30).forEach(event => {
    counts[event.strength] += 1;
    const recency = Math.max(0.35, 1 - (Date.now() - new Date(event.at).getTime()) / (1000 * 60 * 60 * 24 * 30));
    const weight = strengthWeight(event.strength) * recency;
    weightedOutcome += outcomeValue(event.outcome) * weight;
    totalWeight += weight;
  });
  const momentum = totalWeight ? Math.max(-1, Math.min(1, weightedOutcome / totalWeight)) : 0;
  const confidence = clamp((counts.strong * 0.2) + (counts.moderate * 0.09) + (counts.weak * 0.025));
  return { counts, total: relevant.length, momentum: Number(momentum.toFixed(3)), confidence: Number(confidence.toFixed(3)), recent: relevant.slice(-8).reverse() };
}

function selectActiveConcept(profile, activeConceptId) {
  const concepts = Object.values(profile.concepts || {});
  if (activeConceptId && profile.concepts[activeConceptId]) return profile.concepts[activeConceptId];
  return concepts.find(concept => isReviewDue(concept))
    || concepts.filter(concept => concept.status === 'needs-review').sort((a, b) => a.mastery - b.mastery)[0]
    || concepts.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]
    || null;
}

function weakPrerequisite(profile, concept) {
  return (concept?.prerequisites || [])
    .map(id => profile.concepts[id])
    .filter(Boolean)
    .sort((a, b) => a.mastery - b.mastery)
    .find(item => item.status === 'needs-review' || (item.attempts > 0 && item.mastery < 0.48)) || null;
}

function actionPlan(profile, concept, evidence) {
  if (!concept) return {
    kind: 'discover', label: 'Establish a starting point', modality: 'diagnostic', urgency: 'normal', automatic: false,
    reason: 'The tutor needs one authentic response before personalizing the learning route.',
    prompt: 'Teach me a topic and begin with a short diagnostic.',
  };
  const prerequisite = weakPrerequisite(profile, concept);
  if (prerequisite) return {
    kind: 'rebuild-prerequisite', label: 'Repair the foundation', modality: 'worked-example', urgency: 'high', automatic: true,
    targetConceptId: prerequisite.id, targetConceptLabel: prerequisite.label,
    reason: prerequisite.label + ' is a weak prerequisite for ' + concept.label + ', so advancing now would compound the gap.',
    prompt: 'Rebuild ' + prerequisite.label + ' with one worked example, then reconnect it to ' + concept.label + '.',
  };
  if (isReviewDue(concept)) return {
    kind: 'spaced-review', label: 'Run a retention check', modality: 'retrieval', urgency: 'high', automatic: true,
    reason: 'This concept is due for retrieval practice; recall without a recap gives the cleanest retention evidence.',
    prompt: 'Review me on ' + concept.label + ' without giving me a recap first.',
  };
  if (concept.misconceptions?.length || concept.incorrectAttempts >= 2 || evidence.momentum < -0.35) return {
    kind: 'repair-misconception', label: 'Repair the misconception', modality: bestStrategy(concept) || 'worked-example', urgency: 'high', automatic: true,
    reason: concept.misconceptions?.[0]?.text || 'Repeated negative evidence suggests the current mental model needs rebuilding.',
    prompt: 'Explain ' + concept.label + ' using a contrast that directly fixes my likely misconception.',
  };
  if (concept.attempts === 0 || concept.confidence < 0.22) return {
    kind: 'diagnostic', label: 'Calibrate the lesson', modality: 'diagnostic', urgency: 'normal', automatic: true,
    reason: 'The tutor has too little strong evidence to choose an appropriate depth confidently.',
    prompt: 'Give me one short diagnostic on ' + concept.label + '.',
  };
  if (concept.mastery < 0.55) return {
    kind: 'guided-practice', label: 'Practice with support', modality: bestStrategy(concept) || 'worked-example', urgency: 'normal', automatic: true,
    reason: 'Understanding is still forming, so one scaffolded application is more useful than another long explanation.',
    prompt: 'Walk me through one application of ' + concept.label + ', then let me finish the final step.',
  };
  if (concept.mastery < 0.8 || (concept.assessmentBreakdown?.application?.attempts || 0) < 2) return {
    kind: 'apply', label: 'Apply in a new scenario', modality: 'application', urgency: 'normal', automatic: true,
    reason: 'The foundation is present, but application evidence is not yet strong enough to advance confidently.',
    prompt: 'Give me a new application problem for ' + concept.label + '.',
  };
  if ((concept.assessmentBreakdown?.transfer?.attempts || 0) < 1) return {
    kind: 'transfer', label: 'Test flexible understanding', modality: 'transfer', urgency: 'normal', automatic: true,
    reason: 'Mastery looks strong in familiar contexts; a transfer task checks whether the idea generalizes.',
    prompt: 'Challenge me to use ' + concept.label + ' in a different context.',
  };
  return {
    kind: 'advance', label: 'Advance one level', modality: 'next-concept', urgency: 'low', automatic: true,
    reason: 'Multiple forms of evidence support moving forward without another repetitive check.',
    prompt: 'Take me one level deeper from ' + concept.label + '.',
  };
}

export function buildOrchestratorSnapshot({ learnerProfile, learningEvents, tutorState = {}, activeConceptId = null } = {}) {
  const profile = normalizeLearnerProfile(learnerProfile);
  const concept = selectActiveConcept(profile, activeConceptId || tutorState.activeConceptId);
  const evidence = evidenceSummary(learningEvents, concept?.id || null);
  const plan = actionPlan(profile, concept, evidence);
  const allConcepts = Object.values(profile.concepts || {});
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    activeConcept: concept ? { id: concept.id, label: concept.label, mastery: concept.mastery, confidence: concept.confidence, status: concept.status, difficulty: concept.difficultyLevel } : null,
    nextMove: { ...plan, conceptId: concept?.id || null, conceptLabel: concept?.label || null },
    evidence: { ...evidence, recent: evidence.recent.map(({ id, source, type, outcome, strength, detail, at }) => ({ id, source, type, outcome, strength, detail, at })) },
    learningState: {
      momentum: evidence.momentum > 0.28 ? 'accelerating' : evidence.momentum < -0.28 ? 'struggling' : 'steady',
      evidencedConcepts: allConcepts.filter(item => item.status !== 'unassessed').length,
      dueReviews: allConcepts.filter(item => isReviewDue(item)).length,
      misconceptions: allConcepts.reduce((sum, item) => sum + (item.misconceptions?.length || 0), 0),
    },
    guardrails: {
      canvasIsWeakEvidence: true,
      requiresAssessmentForMastery: true,
      maxConsecutiveChecks: 1,
      explanationBeforeRetry: true,
    },
  };
}

export function applyOrchestratorToDecision(baseDecision, snapshot, { style = 'adaptive', assessment = null } = {}) {
  const decision = { ...baseDecision, orchestrator: snapshot };
  if (style === 'quick' || assessment || !snapshot?.nextMove?.automatic) return decision;
  const move = snapshot.nextMove;
  if (move.kind === 'rebuild-prerequisite') {
    return { ...decision, action: 'revisit', shouldAsk: false, strategy: 'worked-example', reason: move.reason, orchestratorOverride: true };
  }
  if (move.kind === 'repair-misconception') {
    return { ...decision, action: 'clarify', shouldAsk: false, strategy: move.modality === 'analogy' ? 'analogy' : 'worked-example', reason: move.reason, orchestratorOverride: true };
  }
  return decision;
}

export function eventFromAssessment({ assessment, concept, source = 'chat', strategy = null, chatId = null, detail = '' } = {}) {
  const classification = assessment?.classification;
  return createLearningEvent({
    source,
    type: source === 'quiz' ? 'quiz-answer' : 'assessed-response',
    conceptId: concept?.id || null,
    conceptLabel: concept?.label || null,
    outcome: classification === 'correct' ? 'positive' : classification === 'partial' ? 'partial' : classification === 'incorrect' ? 'negative' : 'neutral',
    strength: 'strong', strategy, chatId,
    detail: detail || (classification ? 'Response evaluated as ' + classification + '.' : ''),
    metadata: { classification, confidence: assessment?.confidence ?? null },
  });
}
