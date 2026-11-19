import { ASSESSMENT_TYPES, isReviewDue, projectedMastery, TEACHING_STRATEGIES } from './learner-model.js';

export function chooseAssessmentPlan(concept, now = new Date()) {
  let type = 'application';
  if (isReviewDue(concept, now)) type = 'delayed';
  else if (concept.attempts === 0) type = 'diagnostic';
  else if (!concept.assessmentBreakdown?.recall?.attempts) type = 'recall';
  else if ((concept.assessmentBreakdown?.application?.attempts || 0) < 2) type = 'application';
  else if (concept.misconceptions?.length && !(concept.assessmentBreakdown?.misconception?.attempts || 0)) type = 'misconception';
  else if (concept.mastery >= 0.62) type = 'transfer';
  const difficulty = Math.max(1, Math.min(5, Number(concept.difficultyLevel) || (concept.mastery >= 0.75 ? 4 : concept.mastery >= 0.55 ? 3 : 2)));
  return { type: ASSESSMENT_TYPES.includes(type) ? type : 'application', difficulty };
}

export function chooseStrategyDecision(concept, action, question = '') {
  const forced = action === 'check' || action === 'diagnose' || action === 'review' ? 'socratic' : /\b(visual|diagram|image|flowchart)\b/i.test(question) ? 'visual' : /\b(analogy|intuitively|real.?world)\b/i.test(question) ? 'analogy' : /\b(step.by.step|worked|calculate|solve)\b/i.test(question) || action === 'revisit' ? 'worked-example' : null;
  if (forced) return { strategy: forced, reason: action === 'diagnose' || action === 'review' ? 'The learning activity requires unaided retrieval.' : 'The learner explicitly requested this explanation style.', mode: 'rule' };
  const candidates = action === 'clarify' ? ['example', 'analogy', 'worked-example'] : TEACHING_STRATEGIES.filter(item => item !== 'socratic');
  const totalUses = candidates.reduce((sum, strategy) => sum + (concept.strategyStats?.[strategy]?.uses || 0), 0);
  const ranked = candidates.map(strategy => {
    const stats = concept.strategyStats?.[strategy] || { uses: 0, reward: 0 };
    const averageReward = stats.uses ? stats.reward / stats.uses : 0;
    const exploration = stats.uses ? 0.35 * Math.sqrt(Math.log(totalUses + 2) / stats.uses) : 0.7;
    return { strategy, score: averageReward + exploration, averageReward, uses: stats.uses };
  }).sort((a, b) => b.score - a.score || a.strategy.localeCompare(b.strategy));
  const winner = ranked[0] || { strategy: 'concise', uses: 0, averageReward: 0 };
  return { strategy: winner.strategy, reason: winner.uses ? 'Selected from this learner’s reward history while preserving limited exploration.' : 'Trying an untested teaching strategy to gather evidence.', mode: 'bandit', candidates: ranked.map(item => ({ strategy: item.strategy, score: Number(item.score.toFixed(3)), uses: item.uses })) };
}

export function chooseStrategy(concept, action, question = '') {
  return chooseStrategyDecision(concept, action, question).strategy;
}

export function chooseTeachingAction({ style, tutorState, concept, question, recentMessages, assessment }) {
  const confusionDetected = /\b(confused|confusing|don'?t understand|do not understand|lost|stuck|unclear|what do you mean|simpler|again)\b/i.test(question);
  let preference = tutorState.preferredCheckFrequency;
  if (/\b(fewer questions|stop asking|don'?t quiz|do not quiz)\b/i.test(question)) preference = 'low';
  if (/\b(quiz me more|more questions|test me|challenge me)\b/i.test(question)) preference = 'high';
  const lastAssistant = [...recentMessages].reverse().find(message => message.role === 'assistant');
  const previousAssistantAsked = Boolean(lastAssistant?.content && /\?\s*(?:$|\n)/.test(lastAssistant.content.trim()));
  const pendingType = tutorState.pendingAssessmentType || 'recall';
  const pendingDifficulty = tutorState.pendingDifficulty || 1;
  const mastery = projectedMastery(concept, assessment?.classification, confusionDetected && !assessment, pendingType, pendingDifficulty);
  const plan = chooseAssessmentPlan(concept);
  const baseThreshold = preference === 'high' ? 1 : preference === 'low' ? 4 : 2;
  const threshold = mastery < 0.4 ? Math.min(baseThreshold, 1) : mastery > 0.75 ? baseThreshold + 1 : baseThreshold;
  const canAsk = !assessment && !previousAssistantAsked;
  const dueReview = isReviewDue(concept);
  const shouldAsk = canAsk && style !== 'quick' && (style === 'guided' || dueReview || (style === 'adaptive' && (concept.attempts === 0 || confusionDetected || tutorState.exchangesSinceCheck >= threshold)));

  let action = 'explain';
  let reason = 'Continue the explanation at the learner’s current level.';
  if (assessment?.classification === 'incorrect') {
    action = concept.incorrectAttempts >= 1 || mastery < 0.35 ? 'revisit' : 'clarify';
    reason = action === 'revisit' ? 'A repeated misconception requires rebuilding a prerequisite.' : 'A misconception requires a focused correction.';
  } else if (assessment?.classification === 'partial') {
    action = 'clarify';
    reason = 'The learner has part of the idea and needs one gap repaired.';
  } else if (assessment?.classification === 'correct') {
    action = 'advance';
    reason = pendingType === 'delayed' ? 'A delayed review confirmed retention, so the tutor can advance.' : 'The learner demonstrated understanding, so the lesson can move deeper.';
  } else if (confusionDetected) {
    action = 'clarify';
    reason = 'The learner explicitly signaled confusion.';
  } else if (shouldAsk && dueReview) {
    action = 'review';
    reason = 'This concept is due for a spaced retrieval check.';
  } else if (shouldAsk && concept.attempts === 0) {
    action = 'diagnose';
    reason = 'A short diagnostic will establish the learner’s starting point.';
  } else if (shouldAsk) {
    action = 'check';
    reason = 'Enough explanation has occurred to make a short comprehension check useful.';
  }
  const assessmentPlan = shouldAsk ? plan : null;
  const strategyDecision = chooseStrategyDecision(concept, action, question);
  return { action, shouldAsk, confusionDetected, preference, projectedMastery: mastery, reason, assessmentPlan, strategy: strategyDecision.strategy, strategyDecision };
}

export function actionInstruction(action, strategy = 'concise') {
  const strategyInstructions = {
    concise: 'Use a compact, direct explanation.',
    example: 'Use one concrete example and explicitly connect each part of it to the concept.',
    analogy: 'Use one accurate analogy, then state where the analogy stops being accurate.',
    visual: 'Describe the structure spatially and keep the explanation compatible with an attached visual.',
    'worked-example': 'Work through one small example step by step, making the reason for each step explicit.',
    socratic: 'Guide with one purposeful question rather than revealing every step immediately.',
  };
  const instructions = {
    advance: 'Move exactly one level deeper by introducing one closely related idea the student has not yet seen.',
    clarify: 'Repair one specific gap using a simpler contrast. Keep the scope narrow.',
    revisit: 'Rebuild the prerequisite behind the misconception before returning to the current idea.',
    diagnose: 'Give only a two-sentence orientation before the diagnostic; do not teach the full answer first.',
    review: 'Do not reteach first. Ask the retrieval question directly so retention is measured without prompting.',
    check: 'Teach briefly, then give one short assessment of the requested type.',
    explain: 'Explain the current concept clearly at the learner’s present level.',
  };
  return (instructions[action] || instructions.explain) + ' ' + (strategyInstructions[strategy] || strategyInstructions.concise);
}

export function assessmentInstructionForPlan(plan) {
  if (!plan) return '';
  const prompts = {
    diagnostic: 'End with exactly one short diagnostic question that reveals prior understanding; do not ask whether they understand.',
    recall: 'End with exactly one short recall question about the central relationship, not the wording.',
    application: 'End with exactly one new mini-scenario where the learner must apply the idea.',
    transfer: 'End with exactly one question that applies the idea in a meaningfully different context.',
    misconception: 'End with exactly one plausible claim and ask the learner whether it is correct and why.',
    delayed: 'Ask exactly one stand-alone retrieval question. Give no recap, hints, or answer before it.',
  };
  return prompts[plan.type] + ' Target difficulty ' + plan.difficulty + ' of 5.';
}
