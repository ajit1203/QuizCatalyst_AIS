const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const DAY = 24 * 60 * 60 * 1000;

const fillerWords = new Set(['a', 'an', 'and', 'about', 'can', 'could', 'do', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'please', 'simply', 'step', 'the', 'this', 'to', 'using', 'what', 'with', 'you']);
export const ASSESSMENT_TYPES = ['diagnostic', 'recall', 'application', 'transfer', 'misconception', 'delayed'];
export const TEACHING_STRATEGIES = ['concise', 'example', 'analogy', 'visual', 'worked-example', 'socratic'];

export function conceptLabelFromQuestion(question) {
  const cleaned = String(question || '').replace(/^(?:please\s+)?(?:teach me|explain|help me understand|tell me about|what (?:is|are)|how (?:does|do))\s+/i, '').split(/\b(?:using|with|in simple terms|step by step|without|do not|don't)\b/i)[0].replace(/[^a-zA-Z0-9+#.' -]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter(word => word && !fillerWords.has(word.toLowerCase())).slice(0, 5);
  const label = words.join(' ') || 'General study';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function conceptIdFromLabel(label) {
  return String(label || 'general-study').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'general-study';
}

export function defaultLearnerProfile() {
  return { version: 3, learnerId: 'local-learner', concepts: {}, rewardHistory: [], updatedAt: null };
}

const emptyAssessmentBreakdown = () => Object.fromEntries(ASSESSMENT_TYPES.map(type => [type, { attempts: 0, correct: 0 }]));
const emptyStrategyStats = () => Object.fromEntries(TEACHING_STRATEGIES.map(strategy => [strategy, { uses: 0, successes: 0, reward: 0 }]));

function normalizeMisconception(item) {
  if (!item || typeof item !== 'object' || typeof item.text !== 'string' || !item.text.trim()) return null;
  return { text: item.text.trim().slice(0, 240), count: Number.isInteger(item.count) ? Math.max(1, Math.min(item.count, 99)) : 1, lastSeenAt: typeof item.lastSeenAt === 'string' ? item.lastSeenAt : null };
}

function normalizeBreakdown(value) {
  const result = emptyAssessmentBreakdown();
  ASSESSMENT_TYPES.forEach(type => {
    const item = value?.[type];
    if (item && typeof item === 'object') result[type] = { attempts: Math.max(0, Number(item.attempts) || 0), correct: Math.max(0, Number(item.correct) || 0) };
  });
  return result;
}

function normalizeStrategyStats(value) {
  const result = emptyStrategyStats();
  TEACHING_STRATEGIES.forEach(strategy => {
    const item = value?.[strategy];
    if (item && typeof item === 'object') result[strategy] = { uses: Math.max(0, Number(item.uses) || 0), successes: Math.max(0, Number(item.successes) || 0), reward: Number(item.reward) || 0 };
  });
  return result;
}

export function calculateConfidence(concept) {
  const attempts = Math.max(0, Number(concept?.attempts) || 0);
  const breakdown = concept?.assessmentBreakdown || {};
  const diversity = ASSESSMENT_TYPES.filter(type => (breakdown[type]?.attempts || 0) > 0).length;
  const delayed = breakdown.delayed?.attempts || 0;
  return clamp(0.08 + Math.min(attempts, 8) * 0.07 + diversity * 0.07 + Math.min(delayed, 2) * 0.1);
}

export function normalizeConcept(concept, fallbackId = 'general-study') {
  const id = typeof concept?.id === 'string' && concept.id ? concept.id : fallbackId;
  const mastery = clamp(typeof concept?.mastery === 'number' ? concept.mastery : 0.5);
  const normalized = {
    id,
    label: typeof concept?.label === 'string' && concept.label.trim() ? concept.label.trim().slice(0, 80) : 'General study',
    mastery,
    confidence: 0,
    status: 'unassessed',
    difficultyLevel: Math.max(1, Math.min(5, Number(concept?.difficultyLevel) || 1)),
    attempts: Math.max(0, Number(concept?.attempts) || 0),
    correctAttempts: Math.max(0, Number(concept?.correctAttempts) || 0),
    partialAttempts: Math.max(0, Number(concept?.partialAttempts) || 0),
    incorrectAttempts: Math.max(0, Number(concept?.incorrectAttempts) || 0),
    confusionSignals: Math.max(0, Number(concept?.confusionSignals) || 0),
    correctStreak: Math.max(0, Number(concept?.correctStreak) || 0),
    successfulReviews: Math.max(0, Number(concept?.successfulReviews) || 0),
    prerequisites: Array.isArray(concept?.prerequisites) ? [...new Set(concept.prerequisites.filter(item => typeof item === 'string' && item && item !== id))].slice(0, 6) : [],
    assessmentBreakdown: normalizeBreakdown(concept?.assessmentBreakdown),
    strategyStats: normalizeStrategyStats(concept?.strategyStats),
    misconceptions: Array.isArray(concept?.misconceptions) ? concept.misconceptions.map(normalizeMisconception).filter(Boolean).slice(0, 8) : [],
    lastAssessmentType: ASSESSMENT_TYPES.includes(concept?.lastAssessmentType) ? concept.lastAssessmentType : null,
    lastStrategy: TEACHING_STRATEGIES.includes(concept?.lastStrategy) ? concept.lastStrategy : null,
    lastReviewedAt: typeof concept?.lastReviewedAt === 'string' ? concept.lastReviewedAt : null,
    nextReviewAt: typeof concept?.nextReviewAt === 'string' ? concept.nextReviewAt : null,
    createdAt: typeof concept?.createdAt === 'string' ? concept.createdAt : new Date().toISOString(),
    updatedAt: typeof concept?.updatedAt === 'string' ? concept.updatedAt : new Date().toISOString(),
  };
  normalized.confidence = calculateConfidence(normalized);
  normalized.status = normalized.attempts === 0 && normalized.confusionSignals === 0 ? 'unassessed' : mastery >= 0.8 && normalized.confidence >= 0.45 ? 'mastered' : mastery >= 0.55 ? 'developing' : mastery >= 0.35 ? 'learning' : 'needs-review';
  return normalized;
}

export function normalizeLearnerProfile(profile) {
  const initial = defaultLearnerProfile();
  const concepts = {};
  if (profile?.concepts && typeof profile.concepts === 'object') Object.entries(profile.concepts).forEach(([id, concept]) => { concepts[id] = normalizeConcept(concept, id); });
  const rewardHistory = Array.isArray(profile?.rewardHistory) ? profile.rewardHistory.filter(item => item && typeof item === 'object').slice(-200).map(item => ({
    ...item,
    auditStatus: ['confirmed', 'corrected'].includes(item.auditStatus) ? item.auditStatus : 'unreviewed',
    evaluatorConfidence: typeof item.evaluatorConfidence === 'number' ? clamp(item.evaluatorConfidence) : null,
    masteryDelta: typeof item.masteryDelta === 'number' ? item.masteryDelta : null,
  })) : [];
  return { version: 3, learnerId: typeof profile?.learnerId === 'string' ? profile.learnerId : initial.learnerId, concepts, rewardHistory, updatedAt: typeof profile?.updatedAt === 'string' ? profile.updatedAt : null };
}

export function ensureConcept(profile, label, prerequisites = []) {
  const id = conceptIdFromLabel(label);
  if (!profile.concepts[id]) {
    const now = new Date().toISOString();
    profile.concepts[id] = normalizeConcept({ id, label, prerequisites, createdAt: now, updatedAt: now }, id);
  } else if (prerequisites.length) profile.concepts[id].prerequisites = [...new Set([...profile.concepts[id].prerequisites, ...prerequisites.filter(item => item !== id)])].slice(0, 6);
  return profile.concepts[id];
}

export function linkPrerequisites(profile, concept, labels = []) {
  const ids = labels.map(label => ensureConcept(profile, label).id).filter(id => id !== concept.id);
  concept.prerequisites = [...new Set([...concept.prerequisites, ...ids])].slice(0, 6);
  return concept;
}

export function isNewLearningRequest(question) {
  return /^(?:please\s+)?(?:how|what|why|when|where|explain|teach|show|tell|help|give|compare|describe|review|quiz|test|walk me through)\b/i.test(String(question || '').trim());
}

export function selectConcept(profile, tutorState, question, assessment, analysis = null) {
  if (assessment && tutorState.activeConceptId && profile.concepts[tutorState.activeConceptId]) return profile.concepts[tutorState.activeConceptId];
  const explicitSwitch = /\b(?:switch|change|move)\s+(?:the\s+)?topic\s+(?:to|into)\b|\bnew topic\b/i.test(question);
  const analyzedLabel = typeof analysis?.label === 'string' && analysis.label.trim() ? analysis.label.trim() : null;
  if ((explicitSwitch || isNewLearningRequest(question)) && analyzedLabel) return ensureConcept(profile, analyzedLabel);
  if (!explicitSwitch && tutorState.activeConceptId && profile.concepts[tutorState.activeConceptId]) return profile.concepts[tutorState.activeConceptId];
  return ensureConcept(profile, analyzedLabel || conceptLabelFromQuestion(question));
}

const evidenceWeight = type => ({ diagnostic: 0.45, recall: 0.75, application: 1, transfer: 1.2, misconception: 1.05, delayed: 1.35 }[type] || 0.75);

export function masteryDelta(classification, confusionDetected = false, assessmentType = 'recall', difficulty = 1) {
  const base = classification === 'correct' ? 0.1 : classification === 'partial' ? 0.03 : classification === 'incorrect' ? -0.12 : classification === 'unclear' ? -0.03 : 0;
  const challenge = classification === 'correct' ? 1 + Math.max(0, difficulty - 1) * 0.08 : 1;
  let delta = base * evidenceWeight(assessmentType) * challenge;
  if (confusionDetected && !classification) delta -= 0.035;
  return delta;
}

export function projectedMastery(concept, classification, confusionDetected = false, assessmentType = 'recall', difficulty = 1) {
  return clamp(concept.mastery + masteryDelta(classification, confusionDetected, assessmentType, difficulty));
}

export function rewardForAssessment(classification, assessmentType = 'recall', { hintsUsed = 0 } = {}) {
  const base = classification === 'correct' ? 1 : classification === 'partial' ? 0.3 : classification === 'incorrect' ? -0.45 : -0.1;
  return Number((base * evidenceWeight(assessmentType) - Math.min(3, hintsUsed) * 0.08).toFixed(3));
}

export function isReviewDue(concept, now = new Date()) {
  return Boolean(concept?.nextReviewAt && new Date(concept.nextReviewAt).getTime() <= now.getTime());
}

function reviewDate(concept, classification, assessmentType, now) {
  const succeeded = classification === 'correct';
  const successfulReviews = assessmentType === 'delayed' && succeeded ? concept.successfulReviews + 1 : succeeded ? concept.successfulReviews : 0;
  const intervals = [1, 3, 7, 14, 30, 60];
  const days = succeeded ? intervals[Math.min(successfulReviews, intervals.length - 1)] : 1;
  return new Date(now.getTime() + days * DAY).toISOString();
}

export function applyLearningEvidence(profile, conceptId, assessment, { confusionDetected = false, action = 'explain', assessmentType = 'recall', difficulty = 1, strategy = 'concise', hintsUsed = 0 } = {}) {
  const concept = profile.concepts[conceptId];
  if (!concept) return null;
  const now = new Date();
  const type = ASSESSMENT_TYPES.includes(assessmentType) ? assessmentType : 'recall';
  const usedStrategy = TEACHING_STRATEGIES.includes(strategy) ? strategy : 'concise';
  const classification = assessment?.classification || null;
  const masteryBefore = concept.mastery;
  const appliedMasteryDelta = masteryDelta(classification, confusionDetected, type, difficulty);
  concept.mastery = clamp(concept.mastery + appliedMasteryDelta);
  if (assessment) {
    concept.attempts += 1;
    if (classification === 'correct') concept.correctAttempts += 1;
    if (classification === 'partial') concept.partialAttempts += 1;
    if (classification === 'incorrect') concept.incorrectAttempts += 1;
    concept.correctStreak = classification === 'correct' ? concept.correctStreak + 1 : 0;
    concept.difficultyLevel = classification === 'correct' ? Math.min(5, Math.max(concept.difficultyLevel, difficulty + 1)) : classification === 'incorrect' ? Math.max(1, Math.min(concept.difficultyLevel, difficulty - 1)) : concept.difficultyLevel;
    concept.lastReviewedAt = now.toISOString();
    concept.nextReviewAt = reviewDate(concept, classification, type, now);
    concept.lastAssessmentType = type;
    concept.lastStrategy = usedStrategy;
    concept.assessmentBreakdown[type].attempts += 1;
    if (classification === 'correct') concept.assessmentBreakdown[type].correct += 1;
    if (type === 'delayed') concept.successfulReviews = classification === 'correct' ? concept.successfulReviews + 1 : 0;
    const reward = rewardForAssessment(classification, type, { hintsUsed });
    concept.strategyStats[usedStrategy].uses += 1;
    concept.strategyStats[usedStrategy].reward = Number((concept.strategyStats[usedStrategy].reward + reward).toFixed(3));
    if (classification === 'correct') concept.strategyStats[usedStrategy].successes += 1;
    if (assessment.misconception) {
      const text = assessment.misconception.trim().slice(0, 240);
      const existing = concept.misconceptions.find(item => item.text.toLowerCase() === text.toLowerCase());
      if (existing) Object.assign(existing, { count: existing.count + 1, lastSeenAt: now.toISOString() });
      else concept.misconceptions.unshift({ text, count: 1, lastSeenAt: now.toISOString() });
      concept.misconceptions = concept.misconceptions.slice(0, 8);
    }
    profile.rewardHistory.push({
      id: crypto.randomUUID(),
      conceptId,
      conceptLabel: concept.label,
      classification,
      assessmentType: type,
      difficulty,
      strategy: usedStrategy,
      reward,
      masteryBefore,
      masteryAfter: concept.mastery,
      masteryDelta: appliedMasteryDelta,
      evaluatorConfidence: typeof assessment.confidence === 'number' ? clamp(assessment.confidence) : null,
      misconception: typeof assessment.misconception === 'string' ? assessment.misconception.slice(0, 240) : '',
      action,
      auditStatus: 'unreviewed',
      at: now.toISOString(),
    });
    profile.rewardHistory = profile.rewardHistory.slice(-200);
  }
  if (confusionDetected) concept.confusionSignals += 1;
  concept.confidence = calculateConfidence(concept);
  concept.status = concept.attempts === 0 && concept.confusionSignals === 0 ? 'unassessed' : concept.mastery >= 0.8 && concept.confidence >= 0.45 ? 'mastered' : concept.mastery >= 0.55 ? 'developing' : concept.mastery >= 0.35 ? 'learning' : 'needs-review';
  concept.updatedAt = now.toISOString();
  profile.updatedAt = now.toISOString();
  return concept;
}

export function correctRewardEvidence(profile, rewardId, classification) {
  if (!['correct', 'partial', 'incorrect', 'unclear'].includes(classification)) return null;
  const event = profile.rewardHistory.find(item => item.id === rewardId);
  if (!event) return null;
  const concept = profile.concepts[event.conceptId];
  if (!concept) return null;
  const now = new Date().toISOString();
  if (event.classification === classification) {
    event.auditStatus = event.originalClassification && event.originalClassification !== classification ? 'corrected' : 'confirmed';
    event.reviewedAt = now;
    profile.updatedAt = now;
    return { event, concept };
  }

  const previousClassification = event.classification;
  const type = ASSESSMENT_TYPES.includes(event.assessmentType) ? event.assessmentType : 'recall';
  const difficulty = Math.max(1, Math.min(5, Number(event.difficulty) || 1));
  const previousDelta = typeof event.masteryDelta === 'number' ? event.masteryDelta : masteryDelta(previousClassification, false, type, difficulty);
  const correctedDelta = masteryDelta(classification, false, type, difficulty);
  const previousReward = Number(event.reward) || 0;
  const correctedReward = rewardForAssessment(classification, type);
  const counter = value => Math.max(0, value - 1);
  if (previousClassification === 'correct') concept.correctAttempts = counter(concept.correctAttempts);
  if (previousClassification === 'partial') concept.partialAttempts = counter(concept.partialAttempts);
  if (previousClassification === 'incorrect') concept.incorrectAttempts = counter(concept.incorrectAttempts);
  if (classification === 'correct') concept.correctAttempts += 1;
  if (classification === 'partial') concept.partialAttempts += 1;
  if (classification === 'incorrect') concept.incorrectAttempts += 1;
  if (previousClassification === 'correct') concept.assessmentBreakdown[type].correct = counter(concept.assessmentBreakdown[type].correct);
  if (classification === 'correct') concept.assessmentBreakdown[type].correct += 1;
  if (type === 'delayed') {
    if (previousClassification === 'correct') concept.successfulReviews = Math.max(0, concept.successfulReviews - 1);
    if (classification === 'correct') concept.successfulReviews += 1;
  }
  concept.correctStreak = classification === 'correct' ? Math.max(1, concept.correctStreak) : 0;
  concept.mastery = clamp(concept.mastery - previousDelta + correctedDelta);
  const strategy = TEACHING_STRATEGIES.includes(event.strategy) ? event.strategy : 'concise';
  concept.strategyStats[strategy].reward = Number((concept.strategyStats[strategy].reward - previousReward + correctedReward).toFixed(3));
  if (previousClassification === 'correct') concept.strategyStats[strategy].successes = counter(concept.strategyStats[strategy].successes);
  if (classification === 'correct') concept.strategyStats[strategy].successes += 1;
  if (previousClassification === 'incorrect' && classification !== 'incorrect' && event.misconception) {
    const misconception = concept.misconceptions.find(item => item.text.toLowerCase() === event.misconception.toLowerCase());
    if (misconception?.count > 1) misconception.count -= 1;
    else if (misconception) concept.misconceptions = concept.misconceptions.filter(item => item !== misconception);
  }
  concept.confidence = calculateConfidence(concept);
  concept.status = concept.mastery >= 0.8 && concept.confidence >= 0.45 ? 'mastered' : concept.mastery >= 0.55 ? 'developing' : concept.mastery >= 0.35 ? 'learning' : 'needs-review';
  const reviewBasis = type === 'delayed' && classification === 'correct' ? { ...concept, successfulReviews: Math.max(0, concept.successfulReviews - 1) } : concept;
  concept.nextReviewAt = reviewDate(reviewBasis, classification, type, new Date());
  concept.updatedAt = now;
  Object.assign(event, {
    originalClassification: event.originalClassification || previousClassification,
    originalReward: event.originalReward ?? previousReward,
    classification,
    reward: correctedReward,
    masteryDelta: correctedDelta,
    masteryAfter: concept.mastery,
    auditStatus: 'corrected',
    reviewedAt: now,
  });
  profile.updatedAt = now;
  return { event, concept };
}

export function learnerSummary(profile) {
  const concepts = Object.values(profile.concepts);
  const evidenced = concepts.filter(concept => concept.status !== 'unassessed');
  const audited = profile.rewardHistory.filter(event => ['confirmed', 'corrected'].includes(event.auditStatus));
  const corrected = audited.filter(event => event.auditStatus === 'corrected');
  return { conceptCount: concepts.length, masteredCount: concepts.filter(concept => concept.status === 'mastered').length, needsReviewCount: concepts.filter(concept => concept.status === 'needs-review').length, dueReviewCount: concepts.filter(concept => isReviewDue(concept)).length, averageMastery: evidenced.length ? evidenced.reduce((sum, concept) => sum + concept.mastery, 0) / evidenced.length : 0, averageConfidence: evidenced.length ? evidenced.reduce((sum, concept) => sum + concept.confidence, 0) / evidenced.length : 0, misconceptionCount: concepts.reduce((sum, concept) => sum + concept.misconceptions.length, 0), auditedRewardCount: audited.length, evaluatorAgreement: audited.length ? (audited.length - corrected.length) / audited.length : null };
}
