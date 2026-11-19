import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { applyLearningEvidence, conceptIdFromLabel, conceptLabelFromQuestion, correctRewardEvidence, defaultLearnerProfile, ensureConcept, isNewLearningRequest, learnerSummary, linkPrerequisites, normalizeLearnerProfile, selectConcept } from './learner-model.js';
import { actionInstruction, assessmentInstructionForPlan, chooseTeachingAction } from './teaching-policy.js';
import { completeChat, completeIndexChat, providerConfig, providerHealth, streamChat } from './llm-provider.js';
import { chemistryCatalog, simulateReaction } from './chemistry-engine.js';
import { chunkRecord, createStudyDocument, documentMetadata, evenlySampleChunks, selectDocumentChunks } from './source-documents.js';
import { createChunkBatches, deduplicateCandidates, indexedSourceChunks, learningPathProgress, normalizeLearningPath } from './learning-path.js';
import { appendLearningEvent, applyOrchestratorToDecision, buildOrchestratorSnapshot, createLearningEvent, eventFromAssessment, normalizeLearningEvents } from './adaptive-orchestrator.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const port = process.env.PORT || 8787;
const dbFile = process.env.QUIZKATALYST_DB_FILE || fileURLToPath(new URL('../data.json', import.meta.url));

app.use(cors());
app.use(express.json({ limit: '2mb' }));
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const sanitizeAssistantContent = content => String(content || '')
  .replace(/<interactive[-\w]*\b[^>]*\/?\s*>/gi, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

async function readStore() {
  try {
    const store = JSON.parse(await fs.readFile(dbFile, 'utf8'));
    if (!store.chats) {
      const legacyChats = store.messages?.length ? [{ id: crypto.randomUUID(), title: 'Previous conversation', pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tutorState: defaultTutorState(), messages: store.messages }] : [];
      return {
        documents: store.documents || [],
        chats: legacyChats,
        learnerProfile: defaultLearnerProfile(),
        learningPaths: [],
        studyMaterials: [],
        learningEvents: [],
        orchestratorHistory: [],
        quizzes: [],
      };
    }
    return {
      documents: Array.isArray(store.documents) ? store.documents : [],
      chats: Array.isArray(store.chats) ? store.chats.map(chat => ({ ...chat, tutorState: normalizeTutorState(chat.tutorState), messages: Array.isArray(chat.messages) ? chat.messages.map(message => message?.role === 'assistant' ? { ...message, content: sanitizeAssistantContent(message.content) } : message) : [] })) : [],
      learnerProfile: normalizeLearnerProfile(store.learnerProfile),
      learningPaths: Array.isArray(store.learningPaths) ? store.learningPaths : [],
      studyMaterials: Array.isArray(store.studyMaterials) ? store.studyMaterials : [],
      learningEvents: normalizeLearningEvents(store.learningEvents),
      orchestratorHistory: Array.isArray(store.orchestratorHistory) ? store.orchestratorHistory.slice(-120) : [],
      quizzes: Array.isArray(store.quizzes) ? store.quizzes.slice(-20) : [],
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { documents: [], chats: [], learnerProfile: defaultLearnerProfile(), learningPaths: [], studyMaterials: [], learningEvents: [], orchestratorHistory: [], quizzes: [] };
    throw new Error('The data store could not be read safely: ' + error.message);
  }
}
async function saveStore(store) {
  const temporaryFile = dbFile + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(store, null, 2));
  await fs.rename(temporaryFile, dbFile);
}
let mutationQueue = Promise.resolve();
function mutateStore(mutation) {
  const operation = mutationQueue.then(async () => {
    const store = await readStore();
    const result = await mutation(store);
    await saveStore(store);
    return result;
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}
const chatById = (store, id) => store.chats.find(chat => chat.id === id);
const defaultTutorState = () => ({
  exchangesSinceCheck: 0,
  correctStreak: 0,
  confusionSignals: 0,
  masteryScore: 0.5,
  preferredCheckFrequency: 'normal',
  activeConceptId: null,
  activeConceptLabel: null,
  lastPolicyReason: null,
  lastCheckAt: null,
  lastAction: 'explain',
  lastAssessment: null,
  pendingAssessmentType: null,
  pendingDifficulty: null,
  pendingStrategy: null,
  visualRecommended: false,
  preferredVisualType: 'concept-map',
  preferredDomain: 'general',
  preferredRenderer: 'knowledge-map',
});
function normalizeTutorState(state) {
  const initial = defaultTutorState();
  if (!state || typeof state !== 'object') return initial;
  return {
    exchangesSinceCheck: Number.isInteger(state.exchangesSinceCheck) ? Math.max(0, Math.min(state.exchangesSinceCheck, 20)) : 0,
    correctStreak: Number.isInteger(state.correctStreak) ? Math.max(0, Math.min(state.correctStreak, 20)) : 0,
    confusionSignals: Number.isInteger(state.confusionSignals) ? Math.max(0, Math.min(state.confusionSignals, 20)) : 0,
    masteryScore: typeof state.masteryScore === 'number' ? Math.max(0, Math.min(state.masteryScore, 1)) : 0.5,
    preferredCheckFrequency: ['low', 'normal', 'high'].includes(state.preferredCheckFrequency) ? state.preferredCheckFrequency : 'normal',
    activeConceptId: typeof state.activeConceptId === 'string' ? state.activeConceptId : null,
    activeConceptLabel: typeof state.activeConceptLabel === 'string' ? state.activeConceptLabel : null,
    lastPolicyReason: typeof state.lastPolicyReason === 'string' ? state.lastPolicyReason : null,
    lastCheckAt: typeof state.lastCheckAt === 'string' ? state.lastCheckAt : null,
    lastAction: typeof state.lastAction === 'string' ? state.lastAction : 'explain',
    lastAssessment: state.lastAssessment && typeof state.lastAssessment === 'object' ? state.lastAssessment : null,
    pendingAssessmentType: typeof state.pendingAssessmentType === 'string' ? state.pendingAssessmentType : null,
    pendingDifficulty: Number.isInteger(state.pendingDifficulty) ? Math.max(1, Math.min(5, state.pendingDifficulty)) : null,
    pendingStrategy: typeof state.pendingStrategy === 'string' ? state.pendingStrategy : null,
    visualRecommended: Boolean(state.visualRecommended),
    preferredVisualType: ['flowchart', 'concept-map', 'timeline', 'comparison'].includes(state.preferredVisualType) ? state.preferredVisualType : 'concept-map',
    preferredDomain: ['general', 'chemistry', 'mathematics', 'physics', 'computer-science', 'biology', 'history', 'finance', 'economics', 'engineering', 'medicine', 'language'].includes(state.preferredDomain) ? state.preferredDomain : 'general',
    preferredRenderer: ['knowledge-map', 'reaction-lab', 'equation-lab', 'vector-lab', 'system-lab', 'pathway-lab', 'timeline-lab'].includes(state.preferredRenderer) ? state.preferredRenderer : 'knowledge-map',
  };
}
function teachingInstruction(style, shouldAsk) {
  if (style === 'quick') return 'Teaching style: Quick Answer. Give a complete, direct answer. Do not ask a follow-up, comprehension, reflection, or check question. End after the explanation.';
  if (style === 'guided') return 'Teaching style: Guided Lesson. Teach in manageable steps and end with exactly one short application or comprehension question tied to the explanation.';
  if (shouldAsk) return 'Teaching style: Adaptive Tutor. The tutoring policy has decided that a check is useful now. End with exactly one brief application or comprehension question that reveals whether the student understood the key idea.';
  return 'Teaching style: Adaptive Tutor. The tutoring policy has decided not to check understanding in this response. Do not end with a question or an invitation to continue. Give the explanation and stop.';
}
function requiredCheckSuffix(answer, shouldAsk, plan) {
  if (!shouldAsk || /\?\s*$/.test(answer.trim())) return '';
  const label = plan?.type === 'diagnostic' ? 'Starting point' : plan?.type === 'delayed' ? 'Memory check' : plan?.type === 'transfer' ? 'Transfer check' : 'Quick check';
  return '\n\n**' + label + ':** Can you apply the key idea to a new example in your own words?';
}
function assessmentInstruction(assessment) {
  if (!assessment) return '';
  const misconception = assessment.misconception ? ' The specific misconception is: ' + assessment.misconception + '.' : '';
  const correction = assessment.correction ? ' Use this factual correction as the anchor: ' + assessment.correction + '.' : '';
  if (assessment.classification === 'correct') return 'The student answered the previous check correctly. Confirm the specific relationship in one sentence, then teach exactly one closely related next-level idea in two or three sentences. A confirmation by itself is incomplete. Skip basic repetition and do not ask another question in this response.';
  if (assessment.classification === 'partial') return 'The student’s previous answer was partly correct. Acknowledge the correct part, repair the missing part with one concrete example, and keep the explanation focused.' + misconception + correction;
  if (assessment.classification === 'incorrect') return 'The student’s previous answer is incorrect. Begin the response exactly with "Not quite." Never call the answer, summary, reasoning, or idea good or correct. Immediately state the corrected relationship, then explain it once with a simpler contrast or example. Do not ask another question in this response.' + misconception + correction;
  return 'The student’s response to the previous check was unclear. Restate the idea more simply and show one concrete example.';
}
function summarizeTitle(question) {
  const clean = question.replace(/[^a-zA-Z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').filter(Boolean).slice(0, 6);
  const title = words.join(' ');
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : 'New chat';
}

async function modelChat(messages, format, signal, role = 'tutor', schema = null, maxTokens) {
  const result = await completeChat({ messages, role, json: format === 'json', schema, signal, maxTokens });
  return { message: { content: result.content }, usage: result.usage, provider: result.provider, model: result.model };
}
async function indexModelChat(messages, schema, maxTokens) {
  const result = await completeIndexChat({ messages, schema, maxTokens });
  return { message: { content: result.content }, provider: result.provider, model: result.model };
}

const assessmentSchema = {
  name: 'student_assessment',
  definition: {
    type: 'object', additionalProperties: false,
    properties: {
      classification: { type: 'string', enum: ['correct', 'partial', 'incorrect', 'unclear'] },
      misconception: { type: 'string' },
      correction: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['classification', 'misconception', 'correction', 'confidence'],
  },
};
const conceptSchema = {
  name: 'concept_analysis',
  definition: {
    type: 'object', additionalProperties: false,
    properties: {
      label: { type: 'string' },
      prerequisites: { type: 'array', items: { type: 'string' } },
      visualRecommended: { type: 'boolean' },
      visualType: { type: 'string', enum: ['flowchart', 'concept-map', 'timeline', 'comparison'] },
      domain: { type: 'string', enum: ['general', 'chemistry', 'mathematics', 'physics', 'computer-science', 'biology', 'history', 'finance', 'economics', 'engineering', 'medicine', 'language'] },
      renderer: { type: 'string', enum: ['knowledge-map', 'reaction-lab', 'equation-lab', 'vector-lab', 'system-lab', 'pathway-lab', 'timeline-lab'] },
    },
    required: ['label', 'prerequisites', 'visualRecommended', 'visualType', 'domain', 'renderer'],
  },
};
const visualSpecSchema = {
  name: 'learning_visual',
  definition: {
    type: 'object', additionalProperties: false,
    properties: {
      title: { type: 'string' },
      type: { type: 'string', enum: ['flowchart', 'concept-map', 'timeline', 'comparison'] },
      summary: { type: 'string' },
      domain: { type: 'string', enum: ['general', 'chemistry', 'mathematics', 'physics', 'computer-science', 'biology', 'history', 'finance', 'economics', 'engineering', 'medicine', 'language'] },
      renderer: { type: 'string', enum: ['knowledge-map', 'reaction-lab', 'equation-lab', 'vector-lab', 'system-lab', 'pathway-lab', 'timeline-lab'] },
      tools: { type: 'array', items: { type: 'string', enum: ['predict-reveal', 'step-through', 'compare-outcomes', 'adjust-variable', 'inspect-structure', 'trace-path'] } },
      activity: {
        type: 'object', additionalProperties: false,
        properties: {
          pattern: { type: 'string', enum: ['explore', 'construct', 'predict', 'diagnose', 'compare', 'sequence', 'optimize'] },
          objective: { type: 'string' },
          reliability: { type: 'string', enum: ['verified', 'source-grounded', 'conceptual'] },
          controls: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, label: { type: 'string' }, unit: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' }, default: { type: 'number' }, step: { type: 'number' } }, required: ['id', 'label', 'unit', 'min', 'max', 'default', 'step'] } },
          metrics: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, label: { type: 'string' }, unit: { type: 'string' }, baseline: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' }, effects: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { controlId: { type: 'string' }, weight: { type: 'number' } }, required: ['controlId', 'weight'] } } }, required: ['id', 'label', 'unit', 'baseline', 'min', 'max', 'effects'] } },
          challenge: { type: 'string' },
        },
        required: ['pattern', 'objective', 'reliability', 'controls', 'metrics', 'challenge'],
      },
      nodes: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' },
            kind: { type: 'string', enum: ['input', 'process', 'decision', 'output', 'concept'] }, step: { type: 'integer' }, notation: { type: 'string' },
          },
          required: ['id', 'label', 'description', 'kind', 'step', 'notation'],
        },
      },
      edges: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: { id: { type: 'string' }, source: { type: 'string' }, target: { type: 'string' }, label: { type: 'string' } },
          required: ['id', 'source', 'target', 'label'],
        },
      },
      steps: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: { id: { type: 'string' }, title: { type: 'string' }, explanation: { type: 'string' }, nodeIds: { type: 'array', items: { type: 'string' } } },
          required: ['id', 'title', 'explanation', 'nodeIds'],
        },
      },
    },
    required: ['title', 'type', 'summary', 'domain', 'renderer', 'tools', 'activity', 'nodes', 'edges', 'steps'],
  },
};
const canvasAnalysisSchema = {
  name: 'canvas_interaction_analysis',
  definition: {
    type: 'object', additionalProperties: false,
    properties: {
      engagementPattern: { type: 'string' },
      observedNeeds: { type: 'array', items: { type: 'string' } },
      recommendation: { type: 'string' },
      nextAction: { type: 'string', enum: ['explain', 'check', 'none'] },
      focusNodeIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['engagementPattern', 'observedNeeds', 'recommendation', 'nextAction', 'focusNodeIds'],
  },
};
const sourceQuizSchema = {
  name: 'source_grounded_quiz',
  definition: {
    type: 'object', additionalProperties: false,
    properties: {
      title: { type: 'string' },
      coveragePlan: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: {
            concept: { type: 'string' },
            importance: { type: 'string', enum: ['essential', 'supporting'] },
            sourceTitle: { type: 'string' },
            sourcePage: { type: 'integer', minimum: 0 },
          },
          required: ['concept', 'importance', 'sourceTitle', 'sourcePage'],
        },
      },
      questions: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: {
            concept: { type: 'string' },
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            answerIndex: { type: 'integer', minimum: 0, maximum: 3 },
            explanation: { type: 'string' },
            sourceTitle: { type: 'string' },
            sourcePage: { type: 'integer', minimum: 0 },
          },
          required: ['concept', 'question', 'options', 'answerIndex', 'explanation', 'sourceTitle', 'sourcePage'],
        },
      },
    },
    required: ['title', 'coveragePlan', 'questions'],
  },
};
const studyMaterialSchema = {
  name: 'source_grounded_study_material',
  definition: {
    type: 'object', additionalProperties: false,
    properties: {
      title: { type: 'string' },
      overview: { type: 'string' },
      estimatedMinutes: { type: 'integer', minimum: 1, maximum: 240 },
      learningObjectives: { type: 'array', items: { type: 'string' } },
      sections: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        title: { type: 'string' }, summary: { type: 'string' }, keyPoints: { type: 'array', items: { type: 'string' } },
        examples: { type: 'array', items: { type: 'string' } }, sourcePage: { type: 'integer', minimum: 0 },
      }, required: ['title', 'summary', 'keyPoints', 'examples', 'sourcePage'] } },
      quickReference: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        term: { type: 'string' }, explanation: { type: 'string' }, sourcePage: { type: 'integer', minimum: 0 },
      }, required: ['term', 'explanation', 'sourcePage'] } },
      flashcards: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        front: { type: 'string' }, back: { type: 'string' }, sourcePage: { type: 'integer', minimum: 0 },
      }, required: ['front', 'back', 'sourcePage'] } },
      reviewPlan: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'overview', 'estimatedMinutes', 'learningObjectives', 'sections', 'quickReference', 'flashcards', 'reviewPlan'],
  },
};
const adaptiveMaterialExplanationSchema = {
  name: 'adaptive_material_explanation',
  definition: {
    type: 'object', additionalProperties: false,
    properties: {
      explanation: { type: 'string' }, analogy: { type: 'string' }, example: { type: 'string' },
      keyPoints: { type: 'array', items: { type: 'string' } },
    },
    required: ['explanation', 'analogy', 'example', 'keyPoints'],
  },
};
const materialMicroCheckSchema = {
  name: 'material_micro_check',
  definition: {
    type: 'object', additionalProperties: false,
    properties: {
      question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } },
      answerIndex: { type: 'integer', minimum: 0, maximum: 3 }, explanation: { type: 'string' },
    },
    required: ['question', 'options', 'answerIndex', 'explanation'],
  },
};
const learningPathSchema = {
  name: 'source_grounded_learning_path',
  definition: {
    type: 'object', additionalProperties: false,
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      concepts: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string' }, label: { type: 'string' }, summary: { type: 'string' },
            prerequisiteIds: { type: 'array', items: { type: 'string' } },
            sourceTitle: { type: 'string' }, sourcePage: { type: 'integer', minimum: 0 },
          },
          required: ['id', 'label', 'summary', 'prerequisiteIds', 'sourceTitle', 'sourcePage'],
        },
      },
    },
    required: ['title', 'description', 'concepts'],
  },
};
const curriculumBatchSchema = {
  name: 'curriculum_batch_inventory',
  definition: {
    type: 'object', additionalProperties: false,
    properties: {
      concepts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string' }, label: { type: 'string' }, summary: { type: 'string' },
        prerequisiteLabels: { type: 'array', items: { type: 'string' } }, importance: { type: 'integer', minimum: 1, maximum: 5 },
        sourceTitle: { type: 'string' }, sourcePage: { type: 'integer', minimum: 0 }, chunkIds: { type: 'array', items: { type: 'string' } },
      }, required: ['id', 'label', 'summary', 'prerequisiteLabels', 'importance', 'sourceTitle', 'sourcePage', 'chunkIds'] } },
      coverage: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        chunkId: { type: 'string' }, classification: { type: 'string', enum: ['educational', 'administrative'] }, conceptIds: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' },
      }, required: ['chunkId', 'classification', 'conceptIds', 'reason'] } },
    }, required: ['concepts', 'coverage'],
  },
};
const curriculumMergeSchema = {
  name: 'hierarchical_curriculum_map',
  definition: {
    type: 'object', additionalProperties: false,
    properties: {
      title: { type: 'string' }, description: { type: 'string' },
      modules: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string' }, label: { type: 'string' }, summary: { type: 'string' }, importance: { type: 'integer', minimum: 1, maximum: 5 },
        concepts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          label: { type: 'string' }, summary: { type: 'string' }, importance: { type: 'integer', minimum: 1, maximum: 5 },
          prerequisiteLabels: { type: 'array', items: { type: 'string' } }, candidateIds: { type: 'array', items: { type: 'string' } },
        }, required: ['label', 'summary', 'importance', 'prerequisiteLabels', 'candidateIds'] } },
      }, required: ['id', 'label', 'summary', 'importance', 'concepts'] } },
    }, required: ['title', 'description', 'modules'],
  },
};

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function extractCurriculumBatch(batch) {
  const source = batch.map(chunk => '[CHUNK ' + chunk.chunkId + ' | ' + chunk.sourceTitle + (chunk.sourcePage ? ' | page ' + chunk.sourcePage : '') + ']\n' + chunk.content).join('\n\n');
  const output = await indexModelChat([
    { role: 'system', content: 'Inventory every educational concept in this bounded source batch. Do not summarize the batch into only one headline. Create distinct teachable concepts, include exact chunkIds supporting each concept, prerequisite labels when evident, and importance from 1 (minor detail) to 5 (foundational or heavily emphasized). Then classify EVERY supplied chunkId exactly once as educational or administrative. Educational chunks must reference at least one returned concept id. Administrative means indexes, copyright, navigation, bibliography, or non-teaching material—not merely a difficult or short passage. Use only the source.' },
    { role: 'user', content: source },
  ], curriculumBatchSchema, 3500);
  return JSON.parse(output.message?.content || '{}');
}

async function extractCurriculumBatchResilient(batch) {
  try { return await extractCurriculumBatch(batch); }
  catch (error) {
    if (batch.length <= 3) throw error;
    const middle = Math.ceil(batch.length / 2);
    const parts = await mapWithConcurrency([batch.slice(0, middle), batch.slice(middle)], 1, extractCurriculumBatchResilient);
    return { concepts: parts.flatMap(part => part.concepts || []), coverage: parts.flatMap(part => part.coverage || []) };
  }
}

async function buildHierarchicalCurriculum(selections, documents) {
  const indexedChunks = indexedSourceChunks(selections);
  const batches = createChunkBatches(indexedChunks, { maxChars: 6500, maxChunks: 8 });
  const batchResults = await mapWithConcurrency(batches, 1, extractCurriculumBatchResilient);
  let candidates = batchResults.flatMap(result => Array.isArray(result?.concepts) ? result.concepts : []);
  let coverage = batchResults.flatMap(result => Array.isArray(result?.coverage) ? result.coverage : []);
  const validIds = new Set(indexedChunks.map(chunk => chunk.chunkId));
  const coveredIds = new Set(coverage.map(item => item?.chunkId).filter(id => validIds.has(id)));
  let missing = indexedChunks.filter(chunk => !coveredIds.has(chunk.chunkId));
  let recoveryBatchCount = 0;
  if (missing.length) {
    const recoveryBatches = createChunkBatches(missing, { maxChars: 12000, maxChunks: 16 });
    recoveryBatchCount = recoveryBatches.length;
    const recovered = await mapWithConcurrency(recoveryBatches, 1, extractCurriculumBatchResilient);
    candidates = candidates.concat(recovered.flatMap(result => Array.isArray(result?.concepts) ? result.concepts : []));
    coverage = coverage.concat(recovered.flatMap(result => Array.isArray(result?.coverage) ? result.coverage : []));
    const recoveredIds = new Set(coverage.map(item => item?.chunkId).filter(id => validIds.has(id)));
    missing = indexedChunks.filter(chunk => !recoveredIds.has(chunk.chunkId));
  }
  if (missing.length) throw new Error('Coverage audit could not classify ' + missing.length + ' source section' + (missing.length === 1 ? '' : 's') + '. Nothing was saved; retry the index build.');
  const deduped = deduplicateCandidates(candidates);
  if (deduped.length < 4) throw new Error('The full-source scan did not identify enough educational concepts.');
  const compactCandidates = deduped.map(candidate => ({ id: candidate.id, label: candidate.label, importance: candidate.importance, prerequisiteLabels: candidate.prerequisiteLabels.slice(0, 4) }));
  const mergeOutput = await indexModelChat([
    { role: 'system', content: 'Organize the complete candidate inventory into a hierarchical curriculum. Create coherent macro modules and preserve every candidate by listing its exact candidate id in one merged concept. Merge genuine synonyms, but never discard a specialized or high-importance concept. Order foundations before dependent modules. prerequisiteLabels must name concepts in the result. Use only candidate evidence; do not invent content.' },
    { role: 'user', content: 'Candidate inventory from a complete batched source scan:\n' + JSON.stringify(compactCandidates) },
  ], curriculumMergeSchema, 3500);
  const merged = JSON.parse(mergeOutput.message?.content || '{}');
  const candidateById = new Map(deduped.map(candidate => [candidate.id, candidate]));
  const represented = new Set();
  const modules = (Array.isArray(merged.modules) ? merged.modules : []).map((module, moduleIndex) => ({
    id: String(module?.id || 'module-' + (moduleIndex + 1)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    label: String(module?.label || 'Module ' + (moduleIndex + 1)).trim(), summary: String(module?.summary || '').trim(), importance: Number(module?.importance) || 3,
    concepts: (Array.isArray(module?.concepts) ? module.concepts : []).map(concept => {
      const linked = (concept.candidateIds || []).map(id => candidateById.get(id)).filter(Boolean);
      linked.forEach(candidate => represented.add(candidate.id));
      const references = linked.flatMap(candidate => candidate.sourceReferences || []);
      const chunks = [...new Set(linked.flatMap(candidate => candidate.chunkIds || []))];
      const primary = references[0] || { sourceTitle: documents[0].name, sourcePage: 0 };
      return { label: concept.label, summary: linked.sort((a, b) => b.importance - a.importance)[0]?.summary || concept.summary, importance: concept.importance, prerequisiteLabels: concept.prerequisiteLabels || [], sourceTitle: primary.sourceTitle, sourcePage: primary.sourcePage, sourceReferences: references, chunkIds: chunks };
    }).filter(concept => concept.chunkIds.length),
  })).filter(module => module.concepts.length);
  const omitted = deduped.filter(candidate => !represented.has(candidate.id));
  if (omitted.length) modules.push({ id: 'additional-source-concepts', label: 'Additional source concepts', summary: 'Concepts retained by the coverage audit because they were not represented in the model-organized modules.', importance: 3, concepts: omitted.map(candidate => ({ ...candidate, sourceTitle: candidate.sourceReferences[0]?.sourceTitle || documents[0].name, sourcePage: candidate.sourceReferences[0]?.sourcePage || 0 })) });
  const flat = modules.flatMap(module => module.concepts.map(concept => ({ ...concept, moduleId: module.id, moduleLabel: module.label })));
  const idByLabel = new Map(flat.map(concept => [String(concept.label).toLowerCase(), conceptIdFromLabel(concept.label)]));
  flat.forEach(concept => { concept.id = conceptIdFromLabel(concept.label); concept.prerequisiteIds = [...new Set((concept.prerequisiteLabels || []).map(label => idByLabel.get(String(label).toLowerCase())).filter(id => id && id !== concept.id))]; });
  const administrativeIds = new Set(coverage.filter(item => item?.classification === 'administrative').map(item => item.chunkId));
  return normalizeLearningPath({
    title: merged.title, description: merged.description,
    modules: modules.map(({ concepts: _concepts, ...module }) => module), concepts: flat,
    indexing: { strategy: 'hierarchical-full-scan', totalChunks: indexedChunks.length, analyzedChunks: indexedChunks.length, coveragePercent: 100, educationalChunks: indexedChunks.length - administrativeIds.size, administrativeChunks: administrativeIds.size, batchCount: batches.length, recoveryBatchCount, candidateConceptCount: deduped.length, generatedConceptCount: flat.length },
  }, { documentIds: documents.map(document => document.id), sourceTitles: documents.map(document => document.name) });
}

async function assessStudentResponse(recentMessages, response) {
  const lastAssistant = [...recentMessages].reverse().find(message => message.role === 'assistant');
  if (!lastAssistant?.content) return null;
  const requestsNewExplanation = /^(?:please\s+)?(?:how|what|why|when|where|who|can|could|would|will|does|do|is|are|explain|teach|show|tell|help|give|compare|describe|review|quiz|test)\b/i.test(response.trim());
  if (requestsNewExplanation) return null;
  const referenceContext = recentMessages.slice(-4).map(message => (message.role === 'assistant' ? 'Tutor: ' : 'Student: ') + message.content).join('\n\n');
  try {
    const output = await modelChat([
      { role: 'system', content: 'You are a strict educational answer grader. Independently verify the subject matter before grading; the tutor context can contain an error and must not override established facts. Compare every claim in the student response with both established knowledge and the intended reference explanation. Watch especially for swapped roles, reversed causes, negation, and correct keywords placed in the wrong relationship. Never infer correctness from keyword overlap or a confident tone. Mark correct only when every central relationship is right, partial when at least one central claim is right and another is missing or wrong, incorrect when a central relationship is reversed or false, and unclear when the message is a new question instead of an answer. For partial or incorrect answers, state one self-contained, factually correct central relationship in fewer than 35 words. Return JSON only: {"classification":"correct|partial|incorrect|unclear","misconception":"one precise sentence or empty","correction":"one complete sentence under 35 words or empty","confidence":0.0}.' },
      { role: 'user', content: 'Recent lesson context, reference explanation, and tutor check:\n' + referenceContext.slice(-5000) + '\n\nStudent response to grade:\n' + response },
    ], 'json', undefined, 'evaluator', assessmentSchema);
    const parsed = JSON.parse(output.message?.content || '{}');
    const classification = ['correct', 'partial', 'incorrect', 'unclear'].includes(parsed.classification) ? parsed.classification : 'unclear';
    const misconception = typeof parsed.misconception === 'string' ? parsed.misconception.trim().slice(0, 180) : '';
    return {
      classification,
      misconception: classification === 'incorrect' && !misconception ? response.trim().slice(0, 180) : misconception,
      correction: typeof parsed.correction === 'string' ? parsed.correction.trim().slice(0, 360) : '',
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(parsed.confidence, 1)) : 0.5,
    };
  } catch (error) {
    console.warn('Student-response evaluation failed:', error.message);
    return null;
  }
}

function inferLearningDomain(text) {
  const value = String(text).toLowerCase();
  if (/\b(organic|chemistry|molecule|atom|bond|reaction|reagent|acid|base|alkane|alkene|polymer)\b/.test(value)) return { domain: 'chemistry', renderer: 'reaction-lab' };
  if (/\b(math|maths|algebra|calculus|equation|function|derivative|integral|geometry|matrix|probability|trig(?:onometry)?|trignomentry|triangle|angle|sine|cosine|tangent|radian|degree)\b/.test(value)) return { domain: 'mathematics', renderer: 'equation-lab' };
  if (/\b(physics|force|velocity|acceleration|vector|circuit|voltage|current|optics|mechanics)\b/.test(value)) return { domain: 'physics', renderer: 'vector-lab' };
  if (/\b(code|computer|algorithm|network|database|software|cpu|memory|programming|neural network)\b/.test(value)) return { domain: 'computer-science', renderer: 'system-lab' };
  if (/\b(biology|cell|gene|dna|protein|enzyme|organ|anatomy|ecosystem|metabolism)\b/.test(value)) return { domain: 'biology', renderer: 'pathway-lab' };
  if (/\b(history|historical|war|empire|revolution|century|civilization|dynasty)\b/.test(value)) return { domain: 'history', renderer: 'timeline-lab' };
  if (/\b(finance|financial|invest|investment|portfolio|interest rate|compound interest|bond|stock|valuation|cash flow|mortgage|loan)\b/.test(value)) return { domain: 'finance', renderer: 'knowledge-map' };
  if (/\b(economics|economy|supply|demand|inflation|gdp|market equilibrium|elasticity|unemployment)\b/.test(value)) return { domain: 'economics', renderer: 'knowledge-map' };
  if (/\b(engineering|load|stress|strain|control system|thermodynamics|fluid|beam|gear)\b/.test(value)) return { domain: 'engineering', renderer: 'knowledge-map' };
  if (/\b(medicine|medical|diagnosis|physiology|pathology|clinical|patient|disease)\b/.test(value)) return { domain: 'medicine', renderer: 'pathway-lab' };
  if (/\b(language|grammar|sentence|vocabulary|verb|noun|pronunciation|translation)\b/.test(value)) return { domain: 'language', renderer: 'knowledge-map' };
  return { domain: 'general', renderer: 'knowledge-map' };
}

async function analyzeConceptRequest(question, sourceContext = '') {
  const inferred = inferLearningDomain(question + ' ' + sourceContext.slice(0, 1000));
  const fallback = { label: conceptLabelFromQuestion(question), prerequisites: [], visualRecommended: inferred.domain !== 'general', visualType: inferred.domain === 'history' ? 'timeline' : inferred.domain === 'chemistry' || inferred.domain === 'computer-science' || inferred.domain === 'biology' ? 'flowchart' : 'concept-map', ...inferred };
  if (!isNewLearningRequest(question)) return fallback;
  try {
    const output = await modelChat([
      { role: 'system', content: 'Extract a compact learning concept and its direct prerequisites. The label must be a canonical topic name of 2-5 words, not a sentence. Prerequisites must be 0-3 canonical topic names, excluding the concept itself. Decide whether an interactive visual would materially improve understanding. Classify the academic domain as general, chemistry, mathematics, physics, computer-science, biology, history, finance, economics, engineering, medicine, or language. Choose its trusted renderer: chemistry=reaction-lab, mathematics=equation-lab, physics=vector-lab, computer-science=system-lab, biology or medicine=pathway-lab, history=timeline-lab, and all other domains=knowledge-map. Never select a chemistry renderer for a non-chemistry lesson.' },
      { role: 'user', content: (sourceContext ? 'Allowed source context:\n' + sourceContext.slice(0, 2500) + '\n\n' : '') + 'Learning request:\n' + question },
    ], 'json', undefined, 'evaluator', conceptSchema);
    const parsed = JSON.parse(output.message?.content || '{}');
    const label = typeof parsed.label === 'string' && parsed.label.trim() ? parsed.label.trim().slice(0, 80) : fallback.label;
    const prerequisites = Array.isArray(parsed.prerequisites) ? parsed.prerequisites.filter(item => typeof item === 'string' && item.trim() && item.trim().toLowerCase() !== label.toLowerCase()).map(item => item.trim().slice(0, 80)).slice(0, 3) : [];
    const allowedDomains = ['general', 'chemistry', 'mathematics', 'physics', 'computer-science', 'biology', 'history', 'finance', 'economics', 'engineering', 'medicine', 'language'];
    const rendererByDomain = { general: 'knowledge-map', chemistry: 'reaction-lab', mathematics: 'equation-lab', physics: 'vector-lab', 'computer-science': 'system-lab', biology: 'pathway-lab', history: 'timeline-lab', finance: 'knowledge-map', economics: 'knowledge-map', engineering: 'knowledge-map', medicine: 'pathway-lab', language: 'knowledge-map' };
    const domain = allowedDomains.includes(parsed.domain) ? parsed.domain : fallback.domain;
    return { label, prerequisites, visualRecommended: Boolean(parsed.visualRecommended), visualType: ['flowchart', 'concept-map', 'timeline', 'comparison'].includes(parsed.visualType) ? parsed.visualType : fallback.visualType, domain, renderer: rendererByDomain[domain] };
  } catch (error) {
    console.warn('Concept analysis failed; using local label fallback:', error.message);
    return fallback;
  }
}

function normalizeCanvasSpec(value, { sourceGrounded = false, trustedDomain = null, groundingText = '' } = {}) {
  if (!value || typeof value !== 'object') return null;
  const allowedTypes = ['flowchart', 'concept-map', 'timeline', 'comparison'];
  const allowedKinds = ['input', 'process', 'decision', 'output', 'concept'];
  const allowedDomains = ['general', 'chemistry', 'mathematics', 'physics', 'computer-science', 'biology', 'history', 'finance', 'economics', 'engineering', 'medicine', 'language'];
  const rendererByDomain = { general: 'knowledge-map', chemistry: 'reaction-lab', mathematics: 'equation-lab', physics: 'vector-lab', 'computer-science': 'system-lab', biology: 'pathway-lab', history: 'timeline-lab', finance: 'knowledge-map', economics: 'knowledge-map', engineering: 'knowledge-map', medicine: 'pathway-lab', language: 'knowledge-map' };
  const allowedTools = ['predict-reveal', 'step-through', 'compare-outcomes', 'adjust-variable', 'inspect-structure', 'trace-path'];
  const domain = allowedDomains.includes(trustedDomain) ? trustedDomain : allowedDomains.includes(value.domain) ? value.domain : 'general';
  const normalizedGrounding = String(groundingText).toLowerCase();
  const seen = new Set();
  const nodes = (Array.isArray(value.nodes) ? value.nodes : []).map((node, index) => {
    const rawId = String(node?.id || 'node-' + (index + 1)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'node-' + (index + 1);
    const id = seen.has(rawId) ? rawId + '-' + (index + 1) : rawId;
    seen.add(id);
    const kind = allowedKinds.includes(node?.kind) ? node.kind : 'concept';
    let rawLabel = String(node?.label || 'Concept').trim().slice(0, 60);
    let description = String(node?.description || '').trim().slice(0, 280);
    const rawNotation = String(node?.notation || '').trim().slice(0, 80);
    const notation = domain !== 'chemistry' || !rawNotation || normalizedGrounding.includes(rawNotation.toLowerCase()) ? rawNotation : '';
    if (domain === 'chemistry') {
      const guardedTerms = ['anti-addition', 'syn-addition', 'stereochemistry', 'stereocenter', 'racemic', 'enantiomer', 'rearrangement', 'hydride shift', 'alkyl shift', 'peroxide', 'radical pathway'];
      const unsupported = guardedTerms.filter(term => (rawLabel + ' ' + description).toLowerCase().includes(term) && !normalizedGrounding.includes(term));
      if (unsupported.length) {
        unsupported.forEach(term => { rawLabel = rawLabel.replace(new RegExp('\\s*\\([^)]*' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^)]*\\)|' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '').trim(); });
        description = 'This step is shown only at the level supported by the lesson. Ask the tutor to verify any additional mechanism or stereochemical detail.';
      }
    }
    const ungroundedChemistryOutput = domain === 'chemistry' && kind === 'output' && !normalizedGrounding.includes(rawLabel.toLowerCase()) && !notation;
    return {
      id,
      label: ungroundedChemistryOutput ? 'Prediction checkpoint' : rawLabel,
      description: ungroundedChemistryOutput ? 'Use the grounded lesson steps to predict this outcome, then ask the tutor to verify your reasoning.' : description,
      kind,
      step: Math.max(1, Math.min(9, Number(node?.step) || index + 1)),
      notation,
    };
  }).filter(node => node.label).slice(0, 9);
  if (nodes.length < 2) return null;
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = (Array.isArray(value.edges) ? value.edges : []).map((edge, index) => ({
    id: String(edge?.id || 'edge-' + (index + 1)).replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 48),
    source: String(edge?.source || ''), target: String(edge?.target || ''), label: String(edge?.label || '').trim().slice(0, 60),
  })).filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target).slice(0, 14);
  const steps = (Array.isArray(value.steps) ? value.steps : []).map((step, index) => ({
    id: String(step?.id || 'step-' + (index + 1)).replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 48),
    title: String(step?.title || 'Step ' + (index + 1)).trim().slice(0, 70),
    explanation: String(step?.explanation || '').trim().slice(0, 320),
    nodeIds: [...new Set((Array.isArray(step?.nodeIds) ? step.nodeIds : []).filter(id => nodeIds.has(id)))],
  })).filter(step => step.nodeIds.length).slice(0, 8);
  const activityValue = value.activity && typeof value.activity === 'object' ? value.activity : {};
  const allowedPatterns = ['explore', 'construct', 'predict', 'diagnose', 'compare', 'sequence', 'optimize'];
  const controls = (Array.isArray(activityValue.controls) ? activityValue.controls : []).map((control, index) => {
    const id = String(control?.id || 'control-' + (index + 1)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'control-' + (index + 1);
    const min = Number.isFinite(Number(control?.min)) ? Math.max(-100000, Math.min(100000, Number(control.min))) : 0;
    const requestedMax = Number.isFinite(Number(control?.max)) ? Number(control.max) : 100;
    const max = Math.max(min + 0.001, Math.min(100000, requestedMax));
    const requestedDefault = Number.isFinite(Number(control?.default)) ? Number(control.default) : (min + max) / 2;
    return { id, label: String(control?.label || 'Variable ' + (index + 1)).slice(0, 48), unit: String(control?.unit || '').slice(0, 16), min, max, default: Math.max(min, Math.min(max, requestedDefault)), step: Math.max(0.001, Math.min(max - min, Math.abs(Number(control?.step)) || (max - min) / 20)) };
  }).filter((control, index, all) => all.findIndex(item => item.id === control.id) === index).slice(0, 4);
  const controlIds = new Set(controls.map(control => control.id));
  const metrics = (Array.isArray(activityValue.metrics) ? activityValue.metrics : []).map((metric, index) => {
    const min = Number.isFinite(Number(metric?.min)) ? Math.max(-1000000, Math.min(1000000, Number(metric.min))) : 0;
    const max = Math.max(min + 0.001, Math.min(1000000, Number.isFinite(Number(metric?.max)) ? Number(metric.max) : 100));
    const baseline = Math.max(min, Math.min(max, Number.isFinite(Number(metric?.baseline)) ? Number(metric.baseline) : (min + max) / 2));
    const effects = (Array.isArray(metric?.effects) ? metric.effects : []).map(effect => ({ controlId: String(effect?.controlId || ''), weight: Math.max(-100000, Math.min(100000, Number(effect?.weight) || 0)) })).filter(effect => controlIds.has(effect.controlId)).slice(0, controls.length);
    return { id: String(metric?.id || 'metric-' + (index + 1)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 32), label: String(metric?.label || 'Outcome ' + (index + 1)).slice(0, 48), unit: String(metric?.unit || '').slice(0, 16), baseline, min, max, effects };
  }).slice(0, 4);
  const activity = {
    pattern: allowedPatterns.includes(activityValue.pattern) ? activityValue.pattern : controls.length ? 'explore' : 'sequence',
    objective: String(activityValue.objective || value.summary || 'Explore how the parts of this concept influence one another.').trim().slice(0, 220),
    reliability: sourceGrounded ? 'source-grounded' : 'conceptual',
    controls,
    metrics,
    challenge: String(activityValue.challenge || 'Change one element, predict what will happen, and explain the result.').trim().slice(0, 220),
  };
  return {
    id: crypto.randomUUID(),
    title: String(value.title || 'Interactive visual').trim().slice(0, 90),
    type: allowedTypes.includes(value.type) ? value.type : 'concept-map',
    summary: String(value.summary || '').trim().slice(0, 320),
    domain,
    renderer: rendererByDomain[domain],
    tools: [...new Set((Array.isArray(value.tools) ? value.tools : []).filter(tool => allowedTools.includes(tool)))].slice(0, 4),
    activity,
    nodes, edges, steps: steps.length ? steps : nodes.map((node, index) => ({ id: 'step-' + (index + 1), title: node.label, explanation: node.description, nodeIds: [node.id] })),
    sourceGrounded,
    createdAt: new Date().toISOString(),
  };
}

async function generateLearningVisual({ question, answer, concept, sourceContext, preferredType, domain = 'general', renderer = 'knowledge-map' }) {
  try {
    const domainRule = domain === 'chemistry'
      ? 'CHEMISTRY GROUNDING RULE: visualize only the exact substrates, products, reagents, formulas, mechanisms, and stereochemical claims explicitly present in the student question or tutor explanation. Never introduce a new molecule, rearrangement, product, formula, stereocenter, condition, or reaction example. If the tutor asks the student to predict an outcome without stating it, create an output node labeled "Prediction checkpoint" with empty notation and do not reveal the answer.'
      : domain === 'mathematics' || domain === 'physics'
        ? 'QUANTITATIVE GROUNDING RULE: use only equations, symbols, variables, values, and relationships explicitly present in the question or tutor explanation. Never invent a numerical result or formula.'
        : 'GROUNDING RULE: do not introduce factual claims or examples that are absent from the question and tutor explanation.';
    const visualMessages = [
      { role: 'system', content: 'Design a compact, accurate interactive learning lab. Use 3-8 nodes and only meaningful edges. Every node must teach one idea. Steps progressively reveal the lesson. Select 2-4 safe tools from predict-reveal, step-through, compare-outcomes, adjust-variable, inspect-structure, trace-path. Also design one activity using a learning pattern: explore, construct, predict, diagnose, compare, sequence, or optimize. Provide 0-4 bounded numeric controls and 0-4 observable metrics. A metric effect weight is the total metric change when its control moves from minimum to maximum; use only defensible directional relationships from the supplied lesson. Use reliability "conceptual" unless the source explicitly provides every relationship. Never claim a model-generated activity is a professional or scientific simulator. The domain and renderer must match the supplied trusted classification. Put useful domain notation in nodes only when it is explicitly grounded: a chemical formula or reaction role for chemistry, a symbol or equation fragment for mathematics/physics, a component label for computing, a structure/pathway label for biology, and a date/period for history. Chemistry content is educational and theoretical: never provide operational synthesis quantities or hazardous laboratory instructions. ' + domainRule + ' In Source Focus, use only supplied context. Output a structured lab specification, never executable code.' },
      { role: 'user', content: 'Trusted domain: ' + domain + '\nTrusted renderer: ' + renderer + '\nPreferred visual type: ' + preferredType + '\nConcept: ' + concept.label + '\nStudent question: ' + question + '\nTutor explanation: ' + answer.slice(0, 4500) + (sourceContext ? '\nSource context:\n' + sourceContext.slice(0, 5000) : '') },
    ];
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const messages = attempt === 0 ? visualMessages : [visualMessages[0], { role: 'user', content: visualMessages[1].content + '\n\nRetry requirement: fill every activity field. If no numeric control is appropriate, use empty controls and metrics arrays, but still provide pattern, objective, reliability, and challenge.' }];
        const output = await modelChat(messages, 'json', undefined, 'tutor', visualSpecSchema, 4000);
        const normalized = normalizeCanvasSpec(JSON.parse(output.message?.content || '{}'), { sourceGrounded: Boolean(sourceContext), trustedDomain: domain, groundingText: question + '\n' + answer + '\n' + sourceContext });
        if (normalized) return normalized;
        lastError = new Error('The activity specification contained fewer than two valid learning nodes.');
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Interactive activity generation failed.');
  } catch (error) {
    console.warn('Interactive visual generation failed:', error.message);
    return null;
  }
}

function summarizeCanvasEvents(events) {
  const counts = {};
  const nodeCounts = {};
  events.forEach(event => {
    counts[event.type] = (counts[event.type] || 0) + 1;
    if (event.nodeId) nodeCounts[event.nodeId] = (nodeCounts[event.nodeId] || 0) + 1;
  });
  return { totalEvents: events.length, counts, nodeCounts, lastEvents: events.slice(-12).map(({ type, nodeId, toolId, stepIndex, value, at }) => ({ type, nodeId: nodeId || null, toolId: toolId || null, stepIndex: Number.isInteger(stepIndex) ? stepIndex : null, value: typeof value === 'number' ? value : null, at })) };
}

async function analyzeCanvasEvents(canvas, events) {
  const summary = summarizeCanvasEvents(events);
  const output = await modelChat([
    { role: 'system', content: 'Analyze interaction telemetry from an educational canvas. Treat clicks, zooming, dragging, and dwell as weak engagement signals, never proof of mastery. Infer only cautious learning needs. Focus on repeated node visits, skipped steps, requests for explanation, and the learner’s path. Recommend one useful next teaching action in one or two sentences.' },
    { role: 'user', content: 'Canvas:\n' + JSON.stringify({ title: canvas.title, type: canvas.type, activity: canvas.activity, nodes: canvas.nodes, steps: canvas.steps }) + '\nInteraction summary:\n' + JSON.stringify(summary) },
  ], 'json', undefined, 'tutor', canvasAnalysisSchema, 900);
  return { ...JSON.parse(output.message?.content || '{}'), analyzedAt: new Date().toISOString(), eventCount: events.length };
}

function retrieve(documents, question) {
  const words = question.toLowerCase().match(/[a-z]{4,}/g) || [];
  return documents
    .flatMap(document => (Array.isArray(document.chunks) ? document.chunks : []).map(rawChunk => {
      const chunk = chunkRecord(rawChunk);
      return { name: document.name, content: chunk.content, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, score: words.filter(word => chunk.content.toLowerCase().includes(word)).length };
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

const visualCue = /\b(diag\w*|architectur\w*|flow ?chart|topology|anatomy|lifecycle|circuit schematic|map|visual|image|illustration)\b/i;
const stripMarkup = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

async function findHelpfulVisuals(question) {
  if (!visualCue.test(question)) return [];
  const cleanQuestion = question.replace(/[^a-zA-Z0-9 ,'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!cleanQuestion) return [];
  const ignoredWords = new Set(['show', 'find', 'fetch', 'display', 'draw', 'give', 'explain', 'tell', 'about', 'please', 'could', 'would', 'what', 'when', 'where', 'which', 'with', 'from', 'into', 'does', 'work', 'works', 'image', 'visual', 'illustration', 'flowchart', 'flow', 'chart', 'diagram', 'detail', 'detailed', 'stage', 'stages', 'each', 'every', 'more', 'want', 'need', 'the', 'and', 'for', 'that', 'this', 'you', 'your', 'can', 'how', 'its', 'are']);
  const conceptWords = new Set(['architecture', 'process', 'cycle', 'lifecycle', 'structure', 'anatomy', 'pipeline', 'topology', 'circuit', 'network', 'stages', 'components', 'map', 'graph']);
  const normalizedWords = (cleanQuestion.toLowerCase().match(/[a-z0-9'-]+/g) || []).map(word => {
    if (word.startsWith('architectur')) return 'architecture';
    if (word.startsWith('diag')) return 'diagram';
    if (word.startsWith('flowchar')) return 'flowchart';
    if (word.startsWith('transformer')) return 'transformer';
    return word;
  });
  const queryWords = [...new Set(normalizedWords)].filter(word => word.length > 2 && !ignoredWords.has(word));
  const topicWords = queryWords.filter(word => !conceptWords.has(word));
  const visualConcepts = queryWords.filter(word => conceptWords.has(word));
  const searchPhrase = [...topicWords.slice(0, 6), ...visualConcepts.slice(0, 2)].join(' ') || cleanQuestion;
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: '"' + searchPhrase + '" diagram',
    gsrnamespace: '6',
    gsrlimit: '8',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '960',
    format: 'json',
    origin: '*',
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('https://commons.wikimedia.org/w/api.php?' + params, {
      signal: controller.signal,
      headers: { 'user-agent': 'QuizKatalyst/1.0 educational tutor' },
    });
    if (!response.ok) return [];
    const data = await response.json();
    const keywords = searchPhrase.match(/[a-z]{4,}/g) || [];
    return Object.values(data.query?.pages || {})
      .map(page => {
        const info = page.imageinfo?.[0];
        const title = String(page.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
        const titleLower = title.toLowerCase();
        const score = keywords.filter(word => titleLower.includes(word)).length + (/diagram|flowchart|architecture|structure|cycle|map/i.test(title) ? 2 : 0) + (/\.svg$/i.test(page.title || '') ? 1 : 0) + (topicWords[0] && titleLower.startsWith(topicWords[0]) ? 2 : 0);
        return {
          title,
          thumbnailUrl: info?.thumburl,
          sourceUrl: info?.descriptionurl,
          creator: stripMarkup(info?.extmetadata?.Artist?.value).slice(0, 100),
          license: stripMarkup(info?.extmetadata?.LicenseShortName?.value || info?.extmetadata?.UsageTerms?.value).slice(0, 60),
          description: stripMarkup(info?.extmetadata?.ImageDescription?.value).slice(0, 180),
          score,
        };
      })
      .filter(item => item.thumbnailUrl?.startsWith('https://') && item.sourceUrl?.startsWith('https://'))
      .sort((a, b) => b.score - a.score)
      .slice(0, 1)
      .map(({ score, ...item }) => item);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

app.get('/', (_req, res) => res.redirect('http://127.0.0.1:5173/'));
app.get('/api', (_req, res) => res.json({ name: 'QuizKatalyst API', status: 'running' }));
app.get('/api/health', async (_req, res) => {
  try {
    res.json(await providerHealth());
  } catch (error) {
    res.status(503).json({ ok: false, provider: providerConfig.activeProvider, preferredProvider: providerConfig.preferredProvider, fallbackReason: providerConfig.fallbackReason, message: error.message });
  }
});
app.get('/api/state', async (_req, res) => {
  try {
    const store = await readStore();
    res.json({ ...store, documents: store.documents.map(documentMetadata), learningPaths: store.learningPaths.map(path => ({ ...path, progress: learningPathProgress(path, store.learnerProfile) })) });
  }
  catch (error) { res.status(500).json({ error: error.message }); }
});
app.get('/api/learner-profile', asyncRoute(async (_req, res) => {
  const store = await readStore();
  res.json({ learnerProfile: store.learnerProfile, summary: learnerSummary(store.learnerProfile) });
}));
app.get('/api/orchestrator', asyncRoute(async (req, res) => {
  const store = await readStore();
  const chat = typeof req.query?.chatId === 'string' ? chatById(store, req.query.chatId) : null;
  const snapshot = buildOrchestratorSnapshot({ learnerProfile: store.learnerProfile, learningEvents: store.learningEvents, tutorState: chat?.tutorState || {}, activeConceptId: chat?.tutorState?.activeConceptId || null });
  res.json({ orchestrator: snapshot, recentDecisions: [...store.orchestratorHistory].reverse().slice(0, 12) });
}));
app.post('/api/orchestrator/feedback', asyncRoute(async (req, res) => {
  const helpful = req.body?.helpful === true;
  const conceptId = typeof req.body?.conceptId === 'string' ? req.body.conceptId : null;
  const result = await mutateStore(store => {
    const concept = conceptId ? store.learnerProfile?.concepts?.[conceptId] : null;
    store.learningEvents = appendLearningEvent(store.learningEvents, {
      source: 'feedback', type: 'learner-feedback', conceptId, conceptLabel: concept?.label || null,
      outcome: helpful ? 'positive' : 'negative', strength: 'moderate',
      detail: helpful ? 'The learner marked the teaching move as helpful.' : 'The learner asked the orchestrator to choose a different approach.',
    });
    return buildOrchestratorSnapshot({ learnerProfile: store.learnerProfile, learningEvents: store.learningEvents, activeConceptId: conceptId });
  });
  res.json({ orchestrator: result });
}));
app.get('/api/learning-paths', asyncRoute(async (_req, res) => {
  const store = await readStore();
  res.json({ learningPaths: store.learningPaths.map(path => ({ ...path, progress: learningPathProgress(path, store.learnerProfile) })) });
}));
app.post('/api/learning-paths', asyncRoute(async (req, res) => {
  const store = await readStore();
  const requestedIds = Array.isArray(req.body?.documentIds) ? new Set(req.body.documentIds.filter(id => typeof id === 'string')) : new Set();
  const pageRanges = req.body?.pageRanges && typeof req.body.pageRanges === 'object' ? req.body.pageRanges : {};
  const documents = store.documents.filter(document => requestedIds.has(document.id));
  if (!documents.length) return res.status(400).json({ error: 'Select at least one uploaded source for the learning path.' });
  let selections;
  try { selections = documents.map(document => selectDocumentChunks(document, pageRanges[document.id])); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (selections.some(selection => !selection.chunks.length)) return res.status(400).json({ error: 'One selected range has no readable content.' });
  try {
    const path = await buildHierarchicalCurriculum(selections, documents);
    const selectionByName = new Map(selections.map(selection => [selection.name, selection]));
    path.concepts.forEach(concept => {
      const selection = selectionByName.get(concept.sourceTitle);
      if (!selection?.pages) concept.sourcePage = 0;
      else if (!selection.pages.has(concept.sourcePage)) concept.sourcePage = [...selection.pages][0];
    });
    const saved = await mutateStore(latestStore => {
      const profile = normalizeLearnerProfile(latestStore.learnerProfile);
      const labelByPathId = new Map(path.concepts.map(concept => [concept.id, concept.label]));
      path.concepts.forEach(concept => {
        const learnerConcept = ensureConcept(profile, concept.label);
        concept.learnerConceptId = learnerConcept.id;
        linkPrerequisites(profile, learnerConcept, concept.prerequisiteIds.map(id => labelByPathId.get(id)).filter(Boolean));
      });
      profile.updatedAt = new Date().toISOString();
      latestStore.learnerProfile = profile;
      latestStore.learningPaths = Array.isArray(latestStore.learningPaths) ? latestStore.learningPaths : [];
      latestStore.learningPaths = [path, ...latestStore.learningPaths.filter(item => item.sourceDocumentIds?.join('|') !== path.sourceDocumentIds.join('|'))].slice(0, 8);
      return { path, learnerProfile: profile };
    });
    res.status(201).json({ learningPath: { ...saved.path, progress: learningPathProgress(saved.path, saved.learnerProfile) }, learnerProfile: saved.learnerProfile });
  } catch (error) {
    res.status(503).json({ error: 'Learning path generation failed: ' + error.message });
  }
}));
app.get('/api/rewards', asyncRoute(async (_req, res) => {
  const store = await readStore();
  const profile = normalizeLearnerProfile(store.learnerProfile);
  res.json({ rewards: [...profile.rewardHistory].reverse(), summary: learnerSummary(profile) });
}));
app.patch('/api/rewards/:id', asyncRoute(async (req, res) => {
  const classification = typeof req.body?.classification === 'string' ? req.body.classification : '';
  if (!['correct', 'partial', 'incorrect', 'unclear'].includes(classification)) return res.status(400).json({ error: 'Choose a valid corrected classification.' });
  const result = await mutateStore(store => {
    const profile = normalizeLearnerProfile(store.learnerProfile);
    const corrected = correctRewardEvidence(profile, req.params.id, classification);
    if (!corrected) return null;
    store.learnerProfile = profile;
    return { ...corrected, learnerProfile: profile, summary: learnerSummary(profile) };
  });
  if (!result) return res.status(404).json({ error: 'Reward evidence not found.' });
  res.json(result);
}));
app.get('/api/visuals', asyncRoute(async (req, res) => {
  const query = typeof req.query?.q === 'string' ? req.query.q.trim() : '';
  if (!query) return res.status(400).json({ error: 'Visual search query required' });
  res.json({ visuals: await findHelpfulVisuals(query) });
}));
app.post('/api/chats/:chatId/messages/:messageId/visuals', asyncRoute(async (req, res) => {
  const store = await readStore();
  const chat = chatById(store, req.params.chatId);
  const messageIndex = chat?.messages?.findIndex(message => message.id === req.params.messageId) ?? -1;
  if (!chat || messageIndex < 0 || chat.messages[messageIndex].role !== 'assistant') return res.status(404).json({ error: 'Assistant message not found' });
  const question = chat.messages.slice(0, messageIndex).reverse().find(message => message.role === 'user')?.content || '';
  if (!visualCue.test(question)) return res.status(400).json({ error: 'The related question does not request a visual' });
  const visuals = await findHelpfulVisuals(question);
  await mutateStore(latestStore => {
    const latestMessage = chatById(latestStore, req.params.chatId)?.messages?.find(message => message.id === req.params.messageId);
    if (latestMessage) Object.assign(latestMessage, { visuals, visualSearchAttempted: true });
  });
  res.json({ visuals });
}));

app.post('/api/chats/:chatId/messages/:messageId/canvas/chat', asyncRoute(async (req, res) => {
  const question = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 800) : '';
  const nodeId = typeof req.body?.nodeId === 'string' ? req.body.nodeId.slice(0, 48) : null;
  if (!question) return res.status(400).json({ error: 'Ask a question about the canvas.' });
  const store = await readStore();
  const chat = chatById(store, req.params.chatId);
  const parentMessage = chat?.messages?.find(message => message.id === req.params.messageId);
  if (!parentMessage?.canvas) return res.status(404).json({ error: 'Interactive canvas not found.' });
  const canvas = parentMessage.canvas;
  const selectedNode = nodeId ? canvas.nodes.find(node => node.id === nodeId) : null;
  const latestChemistryRun = canvas.domain === 'chemistry' && Array.isArray(parentMessage.chemistryRuns) ? parentMessage.chemistryRuns.at(-1) : null;
  const previous = (Array.isArray(parentMessage.canvasChat) ? parentMessage.canvasChat : []).slice(-8).map(({ role, content }) => ({ role, content }));
  const sourceOnly = Array.isArray(parentMessage.citations) && parentMessage.citations.length > 0;
  const groundingInstruction = sourceOnly
    ? 'This canvas came from Source Focus. Use only the parent lesson and canvas data below. If they do not support an answer, say that the uploaded material does not establish it.'
    : 'Use the parent lesson and canvas as the primary context. You may use established background knowledge only to clarify them, and must say when the canvas does not establish a requested result.';
  const domainInstruction = canvas.domain === 'chemistry'
    ? 'For chemistry, independently verify structures, atom connectivity, mechanisms, products, regiochemistry, and stereochemistry before answering. Canvas labels and the parent explanation may be wrong; never repeat them merely because they appear in context. Never infer an unstated reaction product or laboratory condition. Correct a false premise directly. Electrophilic HX addition through a planar carbocation is not stereospecific, so do not call it syn- or anti-addition unless the stated mechanism independently warrants that label.'
    : canvas.domain === 'mathematics' || canvas.domain === 'physics'
      ? 'Verify every equation and numerical relationship. Never invent missing values.'
      : 'Do not invent details absent from the lesson.';
  const output = await modelChat([
    { role: 'system', content: 'You are the tutor embedded inside an interactive learning canvas. Answer the student’s immediate question in 45-110 words. Refer to the selected node when useful, connect it to one neighboring step, and remain conversational. Do not quiz the student unless they explicitly request a quiz. ' + groundingInstruction + ' ' + domainInstruction },
    { role: 'user', content: 'Parent tutor explanation:\n' + String(parentMessage.content || '').slice(0, 4500) + '\n\nCanvas specification:\n' + JSON.stringify({ title: canvas.title, domain: canvas.domain, renderer: canvas.renderer, summary: canvas.summary, nodes: canvas.nodes, edges: canvas.edges, steps: canvas.steps }).slice(0, 7500) + (selectedNode ? '\n\nSelected node:\n' + JSON.stringify(selectedNode) : '') + (latestChemistryRun ? '\n\nLatest deterministic chemistry-lab result (authoritative for this supported combination):\n' + JSON.stringify(latestChemistryRun) : '') },
    ...previous,
    { role: 'user', content: question },
  ], undefined, undefined, 'tutor', null, 650);
  const reply = String(output.message?.content || '').trim();
  if (!reply) throw new Error('The canvas tutor returned an empty response.');
  const userEntry = { id: crypto.randomUUID(), role: 'user', content: question, nodeId, createdAt: new Date().toISOString() };
  const assistantEntry = { id: crypto.randomUUID(), role: 'assistant', content: reply, nodeId, createdAt: new Date().toISOString() };
  const saved = await mutateStore(latestStore => {
    const message = chatById(latestStore, req.params.chatId)?.messages?.find(item => item.id === req.params.messageId);
    if (!message?.canvas) return null;
    message.canvasChat = [...(Array.isArray(message.canvasChat) ? message.canvasChat : []), userEntry, assistantEntry].slice(-30);
    message.canvasInteractions = [...(Array.isArray(message.canvasInteractions) ? message.canvasInteractions : []), { id: crypto.randomUUID(), type: 'canvas_chat', nodeId, toolId: null, stepIndex: null, value: null, at: new Date().toISOString() }].slice(-250);
    return message.canvasChat;
  });
  if (!saved) return res.status(404).json({ error: 'Interactive canvas not found.' });
  res.json({ reply: assistantEntry, messages: saved });
}));

app.post('/api/chats/:chatId/messages/:messageId/canvas/interactions', asyncRoute(async (req, res) => {
  const allowedTypes = ['canvas_open', 'canvas_close', 'node_select', 'node_drag', 'flow_node_move', 'step_change', 'zoom', 'reset', 'explain_request', 'tool_use', 'prediction', 'prediction_submit', 'activity_control', 'activity_reset', 'activity_prediction', 'activity_compare', 'hint_use', 'mechanism_step', 'comparison_pin', 'reveal', 'variable_change', 'canvas_chat', 'chemical_add', 'reaction_run'];
  const incoming = (Array.isArray(req.body?.events) ? req.body.events : []).slice(0, 50).map(event => ({
    id: crypto.randomUUID(),
    type: allowedTypes.includes(event?.type) ? event.type : null,
    nodeId: typeof event?.nodeId === 'string' ? event.nodeId.slice(0, 48) : null,
    toolId: typeof event?.toolId === 'string' ? event.toolId.slice(0, 48) : null,
    stepIndex: Number.isInteger(event?.stepIndex) ? Math.max(0, Math.min(20, event.stepIndex)) : null,
    value: typeof event?.value === 'number' ? Math.max(-10000, Math.min(10000, event.value)) : null,
    at: typeof event?.at === 'string' ? event.at : new Date().toISOString(),
  })).filter(event => event.type);
  if (!incoming.length) return res.status(400).json({ error: 'At least one valid canvas interaction is required.' });
  const saved = await mutateStore(store => {
    const chat = chatById(store, req.params.chatId);
    const message = chat?.messages?.find(item => item.id === req.params.messageId);
    if (!message?.canvas) return null;
    message.canvasInteractions = [...(Array.isArray(message.canvasInteractions) ? message.canvasInteractions : []), ...incoming].slice(-250);
    return { canvas: message.canvas, interactions: message.canvasInteractions, analysis: message.canvasAnalysis || null };
  });
  if (!saved) return res.status(404).json({ error: 'Interactive canvas not found.' });
  let analysis = saved.analysis;
  if (req.body?.analyze === true) {
    try {
      analysis = await analyzeCanvasEvents(saved.canvas, saved.interactions);
      await mutateStore(store => {
        const message = chatById(store, req.params.chatId)?.messages?.find(item => item.id === req.params.messageId);
        if (message?.canvas) {
          message.canvasAnalysis = analysis;
          const concept = message.conceptId ? store.learnerProfile?.concepts?.[message.conceptId] : null;
          store.learningEvents = appendLearningEvent(store.learningEvents, {
            source: 'canvas', type: 'canvas-exploration', conceptId: message.conceptId || null, conceptLabel: concept?.label || message.conceptLabel || null,
            outcome: 'neutral', strength: 'weak', chatId: req.params.chatId,
            detail: analysis.recommendation || 'The learner explored an interactive canvas.',
            metadata: { interactionCount: saved.interactions.length, focusNodeId: analysis.focusNodeId || null },
          });
        }
      });
    } catch (error) {
      console.warn('Canvas interaction analysis failed:', error.message);
    }
  }
  res.json({ interactionCount: saved.interactions.length, analysis });
}));

app.post('/api/chats', async (_req, res) => {
  try {
    const chat = await mutateStore(store => {
      const now = new Date().toISOString();
      const created = { id: crypto.randomUUID(), title: 'New chat', pinned: false, createdAt: now, updatedAt: now, tutorState: defaultTutorState(), messages: [] };
      store.chats.unshift(created);
      return created;
    });
    res.status(201).json({ chat });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.patch('/api/chats/:id', async (req, res) => {
  try {
    const chat = await mutateStore(store => {
      const current = chatById(store, req.params.id);
      if (!current) return null;
      if (typeof req.body.title === 'string' && req.body.title.trim()) current.title = req.body.title.trim().slice(0, 70);
      if (typeof req.body.pinned === 'boolean') current.pinned = req.body.pinned;
      current.updatedAt = new Date().toISOString();
      return current;
    });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json({ chat });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete('/api/chats/:id', async (req, res) => {
  try {
    const removed = await mutateStore(store => {
      const index = store.chats.findIndex(chat => chat.id === req.params.id);
      if (index < 0) return false;
      store.chats.splice(index, 1);
      return true;
    });
    if (!removed) return res.status(404).json({ error: 'Chat not found' });
    res.status(204).end();
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/documents', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Select a file' });
  try {
    const document = await createStudyDocument({ buffer: req.file.buffer, mimetype: req.file.mimetype, name: req.file.originalname });
    await mutateStore(store => { store.documents.unshift(document); });
    res.status(201).json({ document: documentMetadata(document) });
  } catch (error) {
    res.status(422).json({ error: error.message });
  }
});
app.delete('/api/documents/:id', asyncRoute(async (req, res) => {
  const removed = await mutateStore(store => {
    const index = store.documents.findIndex(document => document.id === req.params.id);
    if (index < 0) return false;
    store.documents.splice(index, 1);
    return true;
  });
  if (!removed) return res.status(404).json({ error: 'Study material not found' });
  res.status(204).end();
}));

app.get('/api/chemistry/catalog', (_req, res) => res.json(chemistryCatalog()));

app.post('/api/chats/:chatId/messages/:messageId/canvas/chemistry/run', asyncRoute(async (req, res) => {
  const result = simulateReaction(req.body || {});
  const saved = await mutateStore(store => {
    const message = chatById(store, req.params.chatId)?.messages?.find(item => item.id === req.params.messageId);
    if (!message?.canvas || message.canvas.domain !== 'chemistry') return false;
    const run = { id: crypto.randomUUID(), ...result, createdAt: new Date().toISOString() };
    let learnerProfile = null;
    if (result.verified && result.prediction) {
      learnerProfile = normalizeLearnerProfile(store.learnerProfile);
      const concept = ensureConcept(learnerProfile, result.concept || result.reactionClass);
      const classification = result.prediction.correct ? 'correct' : 'incorrect';
      const updated = applyLearningEvidence(learnerProfile, concept.id, {
        classification,
        confidence: typeof result.prediction.confidence === 'number' ? result.prediction.confidence / 100 : 0.9,
        misconception: result.prediction.correct ? '' : 'Predicted ' + result.prediction.submittedProduct.name + ' instead of ' + result.product.name + ' for ' + result.reactionClass + '.',
        correction: result.explanation,
      }, {
        action: 'chemistry-lab-prediction',
        assessmentType: 'application',
        difficulty: 2,
        strategy: 'visual',
        hintsUsed: result.prediction.hintUsed ? 1 : 0,
      });
      run.learningEvidence = { conceptId: concept.id, classification, mastery: updated?.mastery ?? concept.mastery, confidence: updated?.confidence ?? concept.confidence };
      store.learnerProfile = learnerProfile;
      store.learningEvents = appendLearningEvent(store.learningEvents, eventFromAssessment({
        assessment: { classification, confidence: typeof result.prediction.confidence === 'number' ? result.prediction.confidence / 100 : 0.9 },
        concept, source: 'chemistry', strategy: 'visual', chatId: req.params.chatId,
        detail: 'Deterministic chemistry prediction was ' + classification + '.',
      }));
    }
    message.chemistryRuns = [...(Array.isArray(message.chemistryRuns) ? message.chemistryRuns : []), run].slice(-20);
    message.canvasInteractions = [...(Array.isArray(message.canvasInteractions) ? message.canvasInteractions : []), { id: crypto.randomUUID(), type: 'reaction_run', nodeId: null, toolId: result.verified ? result.reactionClass : 'unsupported', stepIndex: null, value: null, at: run.createdAt }].slice(-250);
    return { run, learnerProfile };
  });
  if (!saved) return res.status(404).json({ error: 'Chemistry canvas not found.' });
  res.status(result.verified ? 200 : 422).json({ result: saved.run, learnerProfile: saved.learnerProfile, summary: saved.learnerProfile ? learnerSummary(saved.learnerProfile) : null });
}));

app.post('/api/chat/stream', asyncRoute(async (req, res) => {
  const store = await readStore();
  const question = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId : '';
  const mode = req.body?.mode === 'source' ? 'source' : 'open';
  const teachingStyle = ['quick', 'guided'].includes(req.body?.teachingStyle) ? req.body.teachingStyle : 'adaptive';
  const wantsDepth = /\b(detailed|in[ -]?depth|deep dive|comprehensive|thorough)\b/i.test(question);
  const currentChat = chatById(store, chatId);
  if (!question) return res.status(400).json({ error: 'Message required' });
  if (!currentChat) return res.status(404).json({ error: 'Chat not found' });
  if (mode === 'source' && !store.documents.length) return res.status(409).json({ error: 'Upload at least one study material before using Source Focus.' });

  const context = mode === 'source' ? retrieve(store.documents, question) : [];
  const sources = context.map(item => '[' + item.name + (item.pageStart ? ' · page ' + item.pageStart : '') + '] ' + item.content).join('\n');
  const citations = [...new Set(context.map(item => item.name))];
  const recentMessages = (Array.isArray(currentChat.messages) ? currentChat.messages : []).slice(-8).filter(message => message.status !== 'generating').map(({ role, content }) => ({ role, content }));
  const recentCanvasAnalysis = [...(Array.isArray(currentChat.messages) ? currentChat.messages : [])].reverse().find(message => message.canvasAnalysis)?.canvasAnalysis || null;
  const tutorState = normalizeTutorState(currentChat.tutorState);
  const assessment = await assessStudentResponse(recentMessages, question);
  const learnerProfile = normalizeLearnerProfile(store.learnerProfile);
  const conceptAnalysis = assessment ? null : await analyzeConceptRequest(question, sources);
  const activeConcept = selectConcept(learnerProfile, tutorState, question, assessment, conceptAnalysis);
  if (conceptAnalysis?.prerequisites?.length) linkPrerequisites(learnerProfile, activeConcept, conceptAnalysis.prerequisites);
  const baseTutoringAction = chooseTeachingAction({ style: teachingStyle, tutorState, concept: activeConcept, question, recentMessages, assessment });
  const initialOrchestrator = buildOrchestratorSnapshot({ learnerProfile, learningEvents: store.learningEvents, tutorState, activeConceptId: activeConcept.id });
  const tutoringAction = applyOrchestratorToDecision(baseTutoringAction, initialOrchestrator, { style: teachingStyle, assessment });
  // Put the cadence instruction last so a model cannot interpret a correction as
  // permission to quiz the student again immediately after a check.
  const styleInstruction = assessmentInstruction(assessment) + ' ' + actionInstruction(tutoringAction.action, tutoringAction.strategy) + ' ' + assessmentInstructionForPlan(tutoringAction.assessmentPlan) + ' ' + teachingInstruction(teachingStyle, tutoringAction.shouldAsk);
  const responseLengthInstruction = tutoringAction.action === 'diagnose' ? 'DIAGNOSTIC TURN OVERRIDE: respond in at most 45 words with a one-sentence orientation followed by exactly one question. Do not use headings, lists, examples, formulas, or a second question.' : tutoringAction.action === 'review' ? 'SPACED REVIEW OVERRIDE: respond with exactly one retrieval question and nothing else. Do not recap, hint, or add a heading.' : 'Default to 120–220 words unless the student asks for more depth.';
  const prerequisiteLabels = activeConcept.prerequisites.map(id => learnerProfile.concepts[id]?.label).filter(Boolean);
  const canvasObservation = recentCanvasAnalysis ? ' Recent canvas observation: ' + recentCanvasAnalysis.recommendation + ' Treat this as a weak interaction signal, not mastery evidence.' : '';
  const orchestratorInstruction = tutoringAction.orchestratorOverride ? ' Closed-loop orchestrator directive: ' + initialOrchestrator.nextMove.prompt + ' Reason: ' + initialOrchestrator.nextMove.reason : '';
  const learnerContextInstruction = 'Current learner model: concept "' + activeConcept.label + '", mastery ' + Math.round(activeConcept.mastery * 100) + '%, confidence ' + Math.round(activeConcept.confidence * 100) + '%, difficulty ' + activeConcept.difficultyLevel + '/5, status ' + activeConcept.status + (prerequisiteLabels.length ? ', prerequisites: ' + prerequisiteLabels.join(', ') : '') + '. Use this only to choose explanation depth; never mention numeric scores unless the student asks.' + canvasObservation + orchestratorInstruction;
  const userMessageId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  const generatedTitle = summarizeTitle(question);

  const reserved = await mutateStore(latestStore => {
    const latestChat = chatById(latestStore, chatId);
    if (!latestChat) return false;
    if (!Array.isArray(latestChat.messages)) latestChat.messages = [];
    latestChat.messages.push(
      { id: userMessageId, role: 'user', content: question },
      { id: assistantMessageId, role: 'assistant', content: '', citations: [], visuals: [], visualSearchAttempted: false, teachingStyle, status: 'generating' },
    );
    latestChat.updatedAt = new Date().toISOString();
    return true;
  });
  if (!reserved) return res.status(404).json({ error: 'Chat not found' });

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    let answer = '';
    const writeDelta = content => {
      if (!content) return;
      answer += content;
      if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify({ type: 'delta', content }) + '\n');
    };
    const forcedCorrection = assessment?.classification === 'incorrect' && assessment.correction?.trim();
    if (forcedCorrection) {
      const correction = assessment.correction.trim().replace(/[.!?]?$/, '.');
      const content = 'Not quite. ' + correction;
      const chunks = content.match(/.{1,30}(?:\s|$)/g) || [content];
      chunks.forEach(writeDelta);
    } else if (tutoringAction.action === 'diagnose') {
      const content = 'Let’s start with a quick baseline so I can match the lesson to you.\n\n**Starting point:** How would you describe ' + activeConcept.label + ' in your own words?';
      const chunks = content.match(/.{1,24}(?:\s|$)/g) || [content];
      chunks.forEach(writeDelta);
    } else if (tutoringAction.action === 'review') {
      const content = '**Memory check:** Without looking back, how would you explain ' + activeConcept.label + ' and apply it to one example?';
      const chunks = content.match(/.{1,24}(?:\s|$)/g) || [content];
      chunks.forEach(writeDelta);
    } else {
      const messages = mode === 'source' ? [
        { role: 'system', content: 'You are a personalized tutor in Source Focus mode. Use only the supplied course sources. Adapt to the student’s prior messages and diagnose misconceptions. If the sources do not support an answer, say so clearly. ' + learnerContextInstruction + ' ' + styleInstruction + ' ' + responseLengthInstruction + ' Use at most two headings and one well-chosen conceptual example. Include equations or numerical examples only when the student requests them or they are essential. Verify every equation, chemical structure, stereochemical claim, and worked example before including it; never invent a formula, mechanism, or stereocenter. Format answers as clean Markdown with short paragraphs, bullets for parallel ideas, numbered steps for sequences, and bold only for key terms. Never draw ASCII art or text-based diagrams; the application attaches a real interactive visual when appropriate. Avoid repetitive introductions.' },
        ...recentMessages,
        { role: 'user', content: 'Course sources:\n' + sources + '\n\nStudent message: ' + question },
      ] : [
        { role: 'system', content: 'You are a personalized tutor in Open Tutor mode. Answer general questions using your knowledge. Adapt to the student’s prior messages and diagnose misconceptions. Be honest when uncertain. ' + learnerContextInstruction + ' ' + styleInstruction + ' ' + responseLengthInstruction + ' Use at most two headings and one well-chosen conceptual example. Include equations or numerical examples only when the student requests them or they are essential. Verify every equation, chemical structure, stereochemical claim, and worked example before including it; never invent a formula, mechanism, or stereocenter. Format answers as clean Markdown with short paragraphs, bullets for parallel ideas, numbered steps for sequences, and bold only for key terms. Never draw ASCII art or text-based diagrams; the application attaches a real interactive visual when appropriate. Avoid repetitive introductions.' },
        ...recentMessages,
        { role: 'user', content: question },
      ];
      await streamChat({
        messages,
        signal: controller.signal,
        maxTokens: tutoringAction.action === 'review' ? 120 : tutoringAction.action === 'diagnose' ? 160 : wantsDepth ? 1400 : 900,
        stop: tutoringAction.shouldAsk ? [] : ['\n\n**Quick check:', '\n**Quick check:', '\n\nQuick check:', '\nQuick check:'],
        onDelta: writeDelta,
      });
    }
    if (!answer.trim()) throw new Error('The configured AI provider returned an empty response.');
    const checkSuffix = requiredCheckSuffix(answer, tutoringAction.shouldAsk, tutoringAction.assessmentPlan);
    if (checkSuffix) {
      answer += checkSuffix;
      if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify({ type: 'delta', content: checkSuffix }) + '\n');
    }
    answer = sanitizeAssistantContent(answer);
    const preferredVisualType = conceptAnalysis?.visualType || tutorState.preferredVisualType || 'concept-map';
    const inferredCanvasDomain = inferLearningDomain(question + ' ' + activeConcept.label);
    const preferredDomain = conceptAnalysis?.domain || (tutorState.preferredDomain !== 'general' ? tutorState.preferredDomain : inferredCanvasDomain.domain);
    const preferredRenderer = conceptAnalysis?.renderer || (tutorState.preferredRenderer !== 'knowledge-map' ? tutorState.preferredRenderer : inferredCanvasDomain.renderer);
    const visualRecommended = conceptAnalysis?.visualRecommended ?? tutorState.visualRecommended;
    const explicitCanvasRequest = /\b(canvas|canavs|acnvas|interactive|playground|sandbox|simulat\w*|live\s+(?:graph|diagram|visual)|drag(?:gable)?|slider)\b/i.test(question);
    const interactiveCue = explicitCanvasRequest || /\b(diag\w*|architectur\w*|flow ?chart|concept map|timeline|pipeline|system|process|algorithm|cycle|stages|components|relationship|compare|versus)\b/i.test(question);
    const shouldGenerateCanvas = explicitCanvasRequest || (!['diagnose', 'review'].includes(tutoringAction.action) && (interactiveCue || tutoringAction.strategy === 'visual' || visualRecommended || (tutoringAction.confusionDetected && activeConcept.confusionSignals > 0)));
    if (shouldGenerateCanvas && !res.destroyed && !res.writableEnded) res.write(JSON.stringify({ type: 'canvas-building' }) + '\n');
    const canvas = shouldGenerateCanvas ? await generateLearningVisual({ question, answer, concept: activeConcept, sourceContext: sources, preferredType: preferredVisualType, domain: preferredDomain, renderer: preferredRenderer }) : null;
    if (!canvas && visualCue.test(question) && !res.destroyed && !res.writableEnded) {
      res.write(JSON.stringify({ type: 'visual-search' }) + '\n');
    }
    const visuals = canvas ? [] : await findHelpfulVisuals(question);

    const completedTutorState = {
      ...tutorState,
      exchangesSinceCheck: tutoringAction.shouldAsk ? 0 : Math.min(tutorState.exchangesSinceCheck + 1, 20),
      correctStreak: assessment?.classification === 'correct' ? Math.min(tutorState.correctStreak + 1, 20) : assessment ? 0 : tutorState.correctStreak,
      confusionSignals: Math.max(0, Math.min(tutorState.confusionSignals + (tutoringAction.confusionDetected || assessment?.classification === 'incorrect' ? 1 : assessment?.classification === 'correct' ? -1 : 0), 20)),
      masteryScore: tutoringAction.projectedMastery,
      preferredCheckFrequency: tutoringAction.preference,
      activeConceptId: activeConcept.id,
      activeConceptLabel: activeConcept.label,
      lastPolicyReason: tutoringAction.reason,
      lastCheckAt: tutoringAction.shouldAsk ? new Date().toISOString() : tutorState.lastCheckAt,
      lastAction: tutoringAction.action,
      lastAssessment: assessment ? { ...assessment, assessedAt: new Date().toISOString() } : tutorState.lastAssessment,
      pendingAssessmentType: tutoringAction.assessmentPlan?.type || null,
      pendingDifficulty: tutoringAction.assessmentPlan?.difficulty || null,
      pendingStrategy: tutoringAction.shouldAsk ? tutoringAction.strategy : null,
      visualRecommended: conceptAnalysis?.visualRecommended ?? tutorState.visualRecommended,
      preferredVisualType,
      preferredDomain,
      preferredRenderer,
    };
    const completion = await mutateStore(latestStore => {
      const latestChat = chatById(latestStore, chatId);
      if (!latestChat) return null;
      const latestProfile = normalizeLearnerProfile(latestStore.learnerProfile);
      const latestConcept = ensureConcept(latestProfile, activeConcept.label);
      if (conceptAnalysis?.prerequisites?.length) linkPrerequisites(latestProfile, latestConcept, conceptAnalysis.prerequisites);
      const updatedConcept = applyLearningEvidence(latestProfile, latestConcept.id, assessment, {
        confusionDetected: tutoringAction.confusionDetected,
        action: tutoringAction.action,
        assessmentType: tutorState.pendingAssessmentType || 'recall',
        difficulty: tutorState.pendingDifficulty || 1,
        strategy: tutorState.pendingStrategy || tutoringAction.strategy,
      });
      completedTutorState.masteryScore = updatedConcept?.mastery ?? completedTutorState.masteryScore;
      completedTutorState.activeConceptId = latestConcept.id;
      completedTutorState.activeConceptLabel = latestConcept.label;
      if (assessment) {
        latestStore.learningEvents = appendLearningEvent(latestStore.learningEvents, eventFromAssessment({ assessment, concept: updatedConcept || latestConcept, source: 'chat', strategy: tutorState.pendingStrategy || tutoringAction.strategy, chatId, detail: 'Tutor check response evaluated as ' + assessment.classification + '.' }));
      } else if (tutoringAction.confusionDetected) {
        latestStore.learningEvents = appendLearningEvent(latestStore.learningEvents, createLearningEvent({ source: 'chat', type: 'confusion-signal', conceptId: latestConcept.id, conceptLabel: latestConcept.label, outcome: 'negative', strength: 'moderate', strategy: tutoringAction.strategy, chatId, detail: 'The learner explicitly signaled confusion.' }));
      }
      const finalOrchestrator = buildOrchestratorSnapshot({ learnerProfile: latestProfile, learningEvents: latestStore.learningEvents, tutorState: completedTutorState, activeConceptId: latestConcept.id });
      latestStore.orchestratorHistory = [...(Array.isArray(latestStore.orchestratorHistory) ? latestStore.orchestratorHistory : []), {
        id: crypto.randomUUID(), chatId, conceptId: latestConcept.id, conceptLabel: latestConcept.label,
        selectedAction: tutoringAction.action, selectedStrategy: tutoringAction.strategy, reason: tutoringAction.reason,
        nextMove: finalOrchestrator.nextMove, overridden: Boolean(tutoringAction.orchestratorOverride), at: new Date().toISOString(),
      }].slice(-120);
      if (latestChat.title === 'New chat') latestChat.title = generatedTitle;
      const assistant = latestChat.messages.find(message => message.id === assistantMessageId);
      if (assistant) Object.assign(assistant, { content: answer, citations, visuals, visualSearchAttempted: !canvas && visualCue.test(question), canvas, canvasInteractions: [], canvasAnalysis: null, canvasChat: [], chemistryRuns: [], teachingStyle, assessment, conceptId: latestConcept.id, conceptLabel: latestConcept.label, policyAction: tutoringAction.action, policyReason: tutoringAction.reason, teachingStrategy: tutoringAction.strategy, strategyDecision: tutoringAction.strategyDecision, assessmentType: tutoringAction.assessmentPlan?.type || null, assessmentDifficulty: tutoringAction.assessmentPlan?.difficulty || null, orchestrator: finalOrchestrator, status: 'complete' });
      latestChat.tutorState = completedTutorState;
      latestStore.learnerProfile = latestProfile;
      latestChat.updatedAt = new Date().toISOString();
      return { title: latestChat.title, learnerProfile: latestProfile, concept: updatedConcept || latestConcept, orchestrator: finalOrchestrator };
    });
    if (!completion) throw new Error('This chat was deleted before the response finished.');
    if (!res.destroyed && !res.writableEnded) {
      res.write(JSON.stringify({ type: 'done', messageId: assistantMessageId, userMessageId, content: answer, citations, visuals, visualSearchAttempted: !canvas && visualCue.test(question), canvas, title: completion.title, teachingStyle, askedCheck: tutoringAction.shouldAsk, assessment, tutorState: completedTutorState, policyAction: tutoringAction.action, policyReason: tutoringAction.reason, teachingStrategy: tutoringAction.strategy, strategyDecision: tutoringAction.strategyDecision, assessmentPlan: tutoringAction.assessmentPlan, concept: completion.concept, learnerProfile: completion.learnerProfile, learnerSummary: learnerSummary(completion.learnerProfile), orchestrator: completion.orchestrator }) + '\n');
      res.end();
    }
  } catch (error) {
    await mutateStore(latestStore => {
      const latestChat = chatById(latestStore, chatId);
      const assistant = latestChat?.messages?.find(message => message.id === assistantMessageId);
      if (assistant) Object.assign(assistant, { content: 'Response interrupted. Please try again.', status: 'error' });
    }).catch(() => undefined);
    if (res.headersSent) {
      if (!res.destroyed && !res.writableEnded) {
        res.write(JSON.stringify({ type: 'error', error: error.name === 'AbortError' ? 'Response cancelled.' : error.message }) + '\n');
        res.end();
      }
    } else res.status(503).json({ error: 'AI provider unavailable: ' + error.message });
  }
}));

app.get('/api/study-materials', asyncRoute(async (_req, res) => {
  const store = await readStore();
  res.json({ studyMaterials: store.studyMaterials });
}));

function materialSectionEvidence(store, material, section) {
  const document = store.documents.find(item => item.id === material.sourceDocumentId);
  if (!document) return [];
  const terms = (section.title + ' ' + section.summary).toLowerCase().match(/[a-z]{4,}/g) || [];
  const uniqueTerms = [...new Set(terms)].slice(0, 24);
  const allChunks = (Array.isArray(document.chunks) ? document.chunks : []).map(chunkRecord).filter(chunk => chunk.content.trim());
  const pageChunks = section.sourcePage > 0 ? allChunks.filter(chunk => chunk.pageStart === section.sourcePage) : [];
  const candidates = pageChunks.length ? pageChunks : allChunks;
  return candidates.map(chunk => ({
    page: Number.isInteger(chunk.pageStart) ? chunk.pageStart : 0,
    excerpt: chunk.content.trim().slice(0, 900),
    score: uniqueTerms.filter(term => chunk.content.toLowerCase().includes(term)).length,
  })).sort((a, b) => b.score - a.score).slice(0, 3).map(({ score, ...item }) => ({ ...item, highlights: uniqueTerms.filter(term => item.excerpt.toLowerCase().includes(term)).slice(0, 8) }));
}

function ensureMaterialSectionLearning(section) {
  if (!section.learning || typeof section.learning !== 'object') section.learning = {};
  section.learning.status = ['understood', 'confused', 'learning'].includes(section.learning.status) ? section.learning.status : 'learning';
  section.learning.interactions = Array.isArray(section.learning.interactions) ? section.learning.interactions.slice(-30) : [];
  section.learning.adaptiveExplanation = section.learning.adaptiveExplanation && typeof section.learning.adaptiveExplanation === 'object' ? section.learning.adaptiveExplanation : null;
  section.learning.microCheck = section.learning.microCheck && typeof section.learning.microCheck === 'object' ? section.learning.microCheck : null;
  return section.learning;
}

app.get('/api/study-materials/:id/sections/:sectionIndex/proof', asyncRoute(async (req, res) => {
  const store = await readStore();
  const material = store.studyMaterials.find(item => item.id === req.params.id);
  const sectionIndex = Number.parseInt(req.params.sectionIndex, 10);
  const section = material?.sections?.[sectionIndex];
  if (!material || !section) return res.status(404).json({ error: 'Study material section not found.' });
  const excerpts = materialSectionEvidence(store, material, section);
  if (!excerpts.length) return res.status(404).json({ error: 'No source passage is available for this section.' });
  res.json({ proof: { title: section.title, sourceTitle: material.sourceTitle, citedPage: section.sourcePage || 0, excerpts } });
}));

app.post('/api/study-materials/:id/sections/:sectionIndex/actions', asyncRoute(async (req, res) => {
  const action = String(req.body?.action || '');
  if (!['understand', 'confused', 'explain-differently', 'test-me', 'answer-check'].includes(action)) return res.status(400).json({ error: 'Choose a valid learning action.' });
  const initialStore = await readStore();
  const material = initialStore.studyMaterials.find(item => item.id === req.params.id);
  const sectionIndex = Number.parseInt(req.params.sectionIndex, 10);
  const section = material?.sections?.[sectionIndex];
  if (!material || !section) return res.status(404).json({ error: 'Study material section not found.' });
  const evidence = materialSectionEvidence(initialStore, material, section);
  const source = evidence.map(item => '[' + material.sourceTitle + (item.page ? ' · page ' + item.page : '') + ']\n' + item.excerpt).join('\n\n');
  const now = new Date().toISOString();

  if (action === 'explain-differently') {
    const style = ['analogy', 'example', 'simpler', 'visual'].includes(req.body?.style) ? req.body.style : 'analogy';
    if (!source) return res.status(400).json({ error: 'No source evidence is available to adapt this explanation.' });
    try {
      const output = await modelChat([
        { role: 'system', content: 'Rewrite one study-material section using only the supplied source evidence. Make the explanation meaningfully different from the original while preserving accuracy. The requested style is ' + style + '. The analogy must explicitly state where it stops being accurate. Do not mention hidden reasoning or learner tracking.' },
        { role: 'user', content: 'SECTION: ' + section.title + '\nORIGINAL: ' + section.summary + '\n\nSOURCE EVIDENCE:\n' + source },
      ], 'json', undefined, 'tutor', adaptiveMaterialExplanationSchema, 1800);
      const parsed = JSON.parse(output.message?.content || '{}');
      const adaptiveExplanation = {
        style, explanation: String(parsed.explanation || '').trim().slice(0, 2400), analogy: String(parsed.analogy || '').trim().slice(0, 1400),
        example: String(parsed.example || '').trim().slice(0, 1400), keyPoints: (Array.isArray(parsed.keyPoints) ? parsed.keyPoints : []).map(item => String(item).trim().slice(0, 500)).filter(Boolean).slice(0, 8), createdAt: now,
      };
      if (!adaptiveExplanation.explanation) throw new Error('The model returned an empty alternative explanation.');
      const saved = await mutateStore(store => {
        const latestMaterial = store.studyMaterials.find(item => item.id === material.id);
        const latestSection = latestMaterial?.sections?.[sectionIndex];
        if (!latestSection) return null;
        const learning = ensureMaterialSectionLearning(latestSection);
        learning.status = 'learning'; learning.adaptiveExplanation = adaptiveExplanation;
        learning.interactions.push({ id: crypto.randomUUID(), action, style, at: now });
        const concept = ensureConcept(store.learnerProfile, latestSection.title);
        store.learningEvents = appendLearningEvent(store.learningEvents, { source: 'material', type: 'explanation-adapted', conceptId: concept.id, conceptLabel: concept.label, outcome: 'partial', strength: 'moderate', strategy: style, detail: 'The learner requested a different explanation.' });
        return { material: latestMaterial, section: latestSection, orchestrator: buildOrchestratorSnapshot({ learnerProfile: store.learnerProfile, learningEvents: store.learningEvents, activeConceptId: concept.id }) };
      });
      return res.json(saved);
    } catch (error) { return res.status(503).json({ error: 'Adaptive explanation failed: ' + error.message }); }
  }

  if (action === 'test-me') {
    if (!source) return res.status(400).json({ error: 'No source evidence is available to create a check.' });
    try {
      const output = await modelChat([
        { role: 'system', content: 'Create one concise multiple-choice understanding check grounded only in the supplied source evidence. Use exactly four distinct options with one unambiguously correct answer. Test application or conceptual distinction rather than trivial wording. The explanation must teach why the answer follows from the source.' },
        { role: 'user', content: 'SECTION: ' + section.title + '\n\nSOURCE EVIDENCE:\n' + source },
      ], 'json', undefined, 'evaluator', materialMicroCheckSchema, 1000);
      const parsed = JSON.parse(output.message?.content || '{}');
      const options = (Array.isArray(parsed.options) ? parsed.options : []).map(item => String(item).trim().slice(0, 300)).filter(Boolean).slice(0, 4);
      if (!String(parsed.question || '').trim() || options.length !== 4) throw new Error('The model did not return a valid four-option check.');
      const microCheck = { id: crypto.randomUUID(), question: String(parsed.question).trim().slice(0, 700), options, answerIndex: Math.max(0, Math.min(3, Number(parsed.answerIndex) || 0)), explanation: String(parsed.explanation || '').trim().slice(0, 1200), selectedIndex: null, classification: null, createdAt: now };
      const saved = await mutateStore(store => {
        const latestMaterial = store.studyMaterials.find(item => item.id === material.id);
        const latestSection = latestMaterial?.sections?.[sectionIndex];
        if (!latestSection) return null;
        const learning = ensureMaterialSectionLearning(latestSection);
        learning.status = 'learning'; learning.microCheck = microCheck;
        learning.interactions.push({ id: crypto.randomUUID(), action, at: now });
        return { material: latestMaterial, section: latestSection };
      });
      return res.json(saved);
    } catch (error) { return res.status(503).json({ error: 'Micro-check generation failed: ' + error.message }); }
  }

  const saved = await mutateStore(store => {
    const latestMaterial = store.studyMaterials.find(item => item.id === material.id);
    const latestSection = latestMaterial?.sections?.[sectionIndex];
    if (!latestSection) return null;
    const learning = ensureMaterialSectionLearning(latestSection);
    const profile = normalizeLearnerProfile(store.learnerProfile);
    const concept = ensureConcept(profile, latestSection.title);
    let result = null;
    if (action === 'understand') {
      learning.status = 'understood';
      learning.interactions.push({ id: crypto.randomUUID(), action, at: now });
      store.learningEvents = appendLearningEvent(store.learningEvents, { source: 'material', type: 'self-report-understood', conceptId: concept.id, conceptLabel: concept.label, outcome: 'positive', strength: 'weak', detail: 'The learner self-reported understanding; assessment is still required for mastery.' });
    } else if (action === 'confused') {
      learning.status = 'confused';
      learning.interactions.push({ id: crypto.randomUUID(), action, at: now });
      applyLearningEvidence(profile, concept.id, null, { confusionDetected: true, action: 'material-confused', strategy: 'example' });
      store.learningEvents = appendLearningEvent(store.learningEvents, { source: 'material', type: 'confusion-signal', conceptId: concept.id, conceptLabel: concept.label, outcome: 'negative', strength: 'moderate', strategy: 'example', detail: 'The learner explicitly marked this material section as confusing.' });
    } else {
      const selectedIndex = Number(req.body?.answerIndex);
      if (!learning.microCheck || !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 3) return { error: 'Choose one answer before submitting the check.' };
      const correct = selectedIndex === learning.microCheck.answerIndex;
      const classification = correct ? 'correct' : 'incorrect';
      learning.microCheck.selectedIndex = selectedIndex; learning.microCheck.classification = classification; learning.microCheck.answeredAt = now;
      learning.status = correct ? 'understood' : 'confused';
      learning.interactions.push({ id: crypto.randomUUID(), action, classification, at: now });
      const updatedConcept = applyLearningEvidence(profile, concept.id, { classification, misconception: correct ? '' : 'The selected answer did not match the source-grounded relationship in ' + latestSection.title + '.', correction: learning.microCheck.explanation, confidence: 0.98 }, { action: 'material-check', assessmentType: 'application', difficulty: 2, strategy: 'socratic' });
      store.learningEvents = appendLearningEvent(store.learningEvents, eventFromAssessment({ assessment: { classification, confidence: 0.98 }, concept: updatedConcept || concept, source: 'material', strategy: 'socratic', detail: 'Source-grounded material micro-check was ' + classification + '.' }));
      result = { correct, classification, answerIndex: learning.microCheck.answerIndex, explanation: learning.microCheck.explanation, concept: updatedConcept };
    }
    store.learnerProfile = profile;
    return { material: latestMaterial, section: latestSection, result, learnerProfile: profile, orchestrator: buildOrchestratorSnapshot({ learnerProfile: profile, learningEvents: store.learningEvents, activeConceptId: concept.id }) };
  });
  if (saved?.error) return res.status(400).json({ error: saved.error });
  res.json(saved);
}));

app.delete('/api/study-materials/:id', asyncRoute(async (req, res) => {
  const removed = await mutateStore(store => {
    store.studyMaterials = Array.isArray(store.studyMaterials) ? store.studyMaterials : [];
    const index = store.studyMaterials.findIndex(material => material.id === req.params.id);
    if (index < 0) return false;
    store.studyMaterials.splice(index, 1);
    return true;
  });
  if (!removed) return res.status(404).json({ error: 'Generated study material not found.' });
  res.status(204).end();
}));

app.post('/api/study-materials', asyncRoute(async (req, res) => {
  const store = await readStore();
  const documentId = typeof req.body?.documentId === 'string' ? req.body.documentId : '';
  const document = store.documents.find(item => item.id === documentId);
  if (!document) return res.status(400).json({ error: 'Choose an uploaded source for the study material.' });
  const materialType = ['study-guide', 'revision-notes', 'cheat-sheet', 'flashcards'].includes(req.body?.materialType) ? req.body.materialType : 'study-guide';
  const depth = ['quick', 'balanced', 'deep'].includes(req.body?.depth) ? req.body.depth : 'balanced';
  const personalized = req.body?.personalized !== false;
  const requestedPageRange = String(req.body?.pageRange || '').trim();
  if (requestedPageRange && !document.pageCount && /\.pdf$/i.test(document.name)) return res.status(400).json({ error: 'Re-upload ' + document.name + ' before selecting exact pages.' });
  let selection;
  try { selection = selectDocumentChunks(document, requestedPageRange); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (!selection.chunks.length) return res.status(400).json({ error: 'No readable text was found in the selected source scope.' });

  const chunkLimit = depth === 'deep' ? 48 : depth === 'quick' ? 24 : 36;
  const selectedChunks = evenlySampleChunks(selection.chunks, chunkLimit);
  const source = selectedChunks.map(chunk => '[' + document.name + (Number.isInteger(chunk.pageStart) ? ' · page ' + chunk.pageStart : '') + ']\n' + chunk.content).join('\n\n');
  const matchingPath = store.learningPaths.find(path => Array.isArray(path.sourceDocumentIds) && path.sourceDocumentIds.includes(document.id));
  const scopedCurriculumConcepts = matchingPath?.concepts?.filter(concept => !selection.pages || selection.pages.has(Number(concept.sourcePage))) || [];
  const curriculum = scopedCurriculumConcepts.length ? scopedCurriculumConcepts.slice(0, 80).map(concept => '- ' + concept.label + ': ' + concept.summary + (concept.sourcePage ? ' (page ' + concept.sourcePage + ')' : '')).join('\n') : 'No prior curriculum index is available for this exact scope. Infer the important concepts directly from the selected source evidence.';
  const relevantLearnerIds = new Set(scopedCurriculumConcepts.map(concept => concept.learnerConceptId).filter(Boolean));
  const allLearnerConcepts = Object.values(normalizeLearnerProfile(store.learnerProfile).concepts);
  const scopedLearnerConcepts = relevantLearnerIds.size ? allLearnerConcepts.filter(concept => relevantLearnerIds.has(concept.id)) : allLearnerConcepts;
  const learnerConcepts = scopedLearnerConcepts
    .sort((a, b) => (a.mastery || 0) - (b.mastery || 0))
    .slice(0, 10)
    .map(concept => '- ' + concept.label + ': mastery ' + Math.round((concept.mastery || 0) * 100) + '%, status ' + concept.status + (concept.misconceptions?.length ? ', misconceptions: ' + concept.misconceptions.slice(-2).map(item => item.label || item.description || item).join('; ') : ''))
    .join('\n');
  const learnerContext = personalized
    ? (learnerConcepts || 'The learner has limited evidence so far. Use clear explanations, concrete examples, and progressive complexity.')
    : 'Personalization is disabled. Use a neutral level appropriate for a prepared student.';
  const formatInstruction = materialType === 'flashcards'
    ? 'Prioritize 16-28 strong retrieval flashcards. Keep sections short and use quickReference for prerequisite definitions.'
    : materialType === 'cheat-sheet'
      ? 'Create a compact, high-density cheat sheet. Prioritize quickReference entries, rules, contrasts, formulas, and common traps. Keep sections concise.'
      : materialType === 'revision-notes'
        ? 'Create exam-ready revision notes with concise sections, high-yield relationships, common mistakes, and a practical review plan.'
        : 'Create a coherent teaching-oriented study guide that builds concepts in a sensible order with explanations and examples.';
  const depthInstruction = depth === 'quick'
    ? 'Quick depth: optimize for a 10-15 minute review and include only the highest-value concepts.'
    : depth === 'deep'
      ? 'Deep depth: cover the important curriculum thoroughly, explain relationships and edge cases, and create a 45-90 minute study resource.'
      : 'Balanced depth: provide useful conceptual coverage for a 25-40 minute study session without unnecessary detail.';
  try {
    const output = await modelChat([
      { role: 'system', content: 'Generate polished study material grounded only in the supplied source. Never add unsupported facts. Use the exact page shown beside evidence for sourcePage; for non-page sources use 0. Cover the essential ideas in the curriculum outline and selected scope, not merely the first pages. Explanations must be self-contained, accurate, and useful to a student. Adapt emphasis and clarity using learner evidence without mentioning scores, tracking, or a learner model in the material. ' + formatInstruction + ' ' + depthInstruction },
      { role: 'user', content: 'Create the study material from this source scope.\n\nSOURCE: ' + document.name + '\nSCOPE: ' + selection.pageRange + '\nFORMAT: ' + materialType + '\nDEPTH: ' + depth + '\n\nCURRICULUM OUTLINE:\n' + curriculum + '\n\nLEARNER CONTEXT:\n' + learnerContext + '\n\nSELECTED SOURCE EVIDENCE:\n' + source },
    ], 'json', undefined, 'tutor', studyMaterialSchema, depth === 'deep' ? 7600 : materialType === 'flashcards' ? 5600 : 6200);
    const parsed = JSON.parse(output.message?.content || '{}');
    const validPage = value => selection.pages?.has(Number(value)) ? Number(value) : selection.pages ? [...selection.pages][0] : 0;
    const cleanList = (value, limit, length = 500) => (Array.isArray(value) ? value : []).map(item => String(item || '').trim().slice(0, length)).filter(Boolean).slice(0, limit);
    const material = {
      id: crypto.randomUUID(),
      title: String(parsed.title || document.name.replace(/\.[^.]+$/, '') + ' Study Material').trim().slice(0, 140),
      overview: String(parsed.overview || '').trim().slice(0, 1800),
      estimatedMinutes: Math.max(1, Math.min(240, Number(parsed.estimatedMinutes) || (depth === 'quick' ? 12 : depth === 'deep' ? 60 : 30))),
      learningObjectives: cleanList(parsed.learningObjectives, 12, 300),
      sections: (Array.isArray(parsed.sections) ? parsed.sections : []).map(section => ({
        title: String(section?.title || '').trim().slice(0, 160), summary: String(section?.summary || '').trim().slice(0, 2400),
        keyPoints: cleanList(section?.keyPoints, 12, 700), examples: cleanList(section?.examples, 8, 1000), sourcePage: validPage(section?.sourcePage),
      })).filter(section => section.title && (section.summary || section.keyPoints.length)).slice(0, 16),
      quickReference: (Array.isArray(parsed.quickReference) ? parsed.quickReference : []).map(item => ({ term: String(item?.term || '').trim().slice(0, 160), explanation: String(item?.explanation || '').trim().slice(0, 700), sourcePage: validPage(item?.sourcePage) })).filter(item => item.term && item.explanation).slice(0, 30),
      flashcards: (Array.isArray(parsed.flashcards) ? parsed.flashcards : []).map(item => ({ front: String(item?.front || '').trim().slice(0, 500), back: String(item?.back || '').trim().slice(0, 1000), sourcePage: validPage(item?.sourcePage) })).filter(item => item.front && item.back).slice(0, 32),
      reviewPlan: cleanList(parsed.reviewPlan, 10, 500),
      materialType, depth, personalized, sourceDocumentId: document.id, sourceTitle: document.name,
      scope: selection.pageRange, selectedPageCount: selection.selectedPageCount, generatedAt: new Date().toISOString(),
    };
    if (!material.sections.length && !material.flashcards.length && !material.quickReference.length) throw new Error('The model did not return usable study content.');
    await mutateStore(latestStore => {
      latestStore.studyMaterials = Array.isArray(latestStore.studyMaterials) ? latestStore.studyMaterials : [];
      latestStore.studyMaterials = [material, ...latestStore.studyMaterials].slice(0, 30);
    });
    res.status(201).json({ studyMaterial: material });
  } catch (error) {
    res.status(503).json({ error: 'Study material generation failed: ' + error.message });
  }
}));

app.post('/api/quiz', asyncRoute(async (req, res) => {
  const store = await readStore();
  const difficulty = ['easy', 'medium', 'hard'].includes(req.body?.difficulty) ? req.body.difficulty : 'medium';
  const coverageMode = req.body?.coverageMode === 'custom' ? 'custom' : 'ai';
  const customCount = Math.max(3, Math.min(20, Number.parseInt(req.body?.count, 10) || 8));
  const count = coverageMode === 'custom' ? customCount : null;
  const requestedIds = Array.isArray(req.body?.documentIds) ? new Set(req.body.documentIds.filter(id => typeof id === 'string')) : null;
  const pageRanges = req.body?.pageRanges && typeof req.body.pageRanges === 'object' ? req.body.pageRanges : {};
  const selectedDocuments = store.documents.filter(document => !requestedIds?.size || requestedIds.has(document.id));
  if (!selectedDocuments.length) return res.status(400).json({ error: 'Select at least one uploaded study source.' });
  let selections;
  try {
    selections = selectedDocuments.map(document => selectDocumentChunks(document, pageRanges[document.id]));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (selections.some(selection => !selection.chunks.length)) {
    const empty = selections.find(selection => !selection.chunks.length);
    return res.status(400).json({ error: 'No readable text was found in ' + empty.name + ' for ' + empty.pageRange + '.' });
  }
  const maxChunks = coverageMode === 'ai' ? 32 : Math.min(36, Math.max(20, customCount * 3));
  const perDocumentLimit = Math.max(1, Math.floor(maxChunks / selections.length));
  const selectedChunks = selections.flatMap(selection => evenlySampleChunks(selection.chunks, perDocumentLimit).map(chunk => ({ ...chunk, name: selection.name })));
  const source = selectedChunks.map(chunk => {
    const page = Number.isInteger(chunk.pageStart) ? ' · page ' + chunk.pageStart : '';
    return '[' + chunk.name + page + ']\n' + chunk.content;
  }).join('\n\n');
  if (!source.trim()) return res.status(400).json({ error: 'The selected study material has no readable content.' });
  const difficultyInstruction = difficulty === 'easy'
    ? 'Easy: test direct recall of explicitly stated definitions, facts, and relationships. Keep distractors clearly distinguishable to a prepared learner.'
    : difficulty === 'hard'
      ? 'Hard: test multi-step reasoning, implications, comparisons, and plausible misconceptions, but every answer must still be provable solely from the supplied source.'
      : 'Medium: mix recall with application, comparison, and interpretation using only relationships established in the source.';
  const coverageInstruction = coverageMode === 'ai'
    ? 'First identify the essential concepts in the supplied scope. Create a coveragePlan and then generate one strong question for each essential concept, adding a second question only when a concept genuinely needs a different skill to assess it. Choose the quiz length yourself between 5 and 15 questions based on conceptual coverage; use as few as 3 only when the selected material is very small. Do not add filler questions merely to make the quiz longer.'
    : 'Create a coveragePlan containing the most important concepts in the supplied scope, then generate exactly ' + customCount + ' questions. Distribute those questions across the highest-importance concepts as evenly as possible. If the custom limit cannot cover everything, prioritize essential concepts and record all identified important concepts in coveragePlan.';
  try {
    const output = await modelChat([
      { role: 'system', content: 'Create a rigorous multiple-choice quiz grounded only in the supplied study sources. Never use outside knowledge. Analyze importance before writing questions. Every essential concept in coveragePlan should be assessed unless a custom question limit makes that impossible. Each question must have exactly four distinct options and exactly one unambiguously correct answer. The concept field must name the coverage concept assessed by that question. Explanations must teach why the correct answer follows from the notes without referring to hidden reasoning. Use the exact uploaded filename as sourceTitle. For PDF material, sourcePage must be the exact page number shown beside the evidence; for non-page sources use 0. Balance correct-answer positions across the quiz. Do not reveal answers in question wording. ' + difficultyInstruction + ' ' + coverageInstruction },
      { role: 'user', content: 'Analyze this selected study scope and create the coverage-first quiz.\n\nUploaded study sources:\n' + source },
    ], 'json', undefined, 'tutor', sourceQuizSchema, coverageMode === 'ai' || customCount > 10 ? 6000 : customCount > 7 ? 4800 : 3600);
    const parsed = JSON.parse(output.message?.content || '{}');
    const allowedNames = new Set(selectedDocuments.map(document => document.name));
    const selectionByName = new Map(selections.map(selection => [selection.name, selection]));
    const questions = (Array.isArray(parsed.questions) ? parsed.questions : []).map((question, index) => {
      const sourceTitle = allowedNames.has(question?.sourceTitle) ? question.sourceTitle : selectedDocuments[0].name;
      const selection = selectionByName.get(sourceTitle);
      const requestedPage = Number(question?.sourcePage);
      const fallbackPage = selection?.pages ? [...selection.pages][0] : 0;
      const sourcePage = selection?.pages?.has(requestedPage) ? requestedPage : fallbackPage;
      return {
        id: crypto.randomUUID(), number: index + 1,
        concept: String(question?.concept || '').trim().slice(0, 120),
        question: String(question?.question || '').trim().slice(0, 500),
        options: (Array.isArray(question?.options) ? question.options : []).map(option => String(option).trim().slice(0, 240)).filter(Boolean).slice(0, 4),
        answerIndex: Number.isInteger(question?.answerIndex) ? Math.max(0, Math.min(3, question.answerIndex)) : 0,
        explanation: String(question?.explanation || '').trim().slice(0, 700),
        sourceTitle, sourcePage,
      };
    }).filter(question => question.question && question.options.length === 4 && question.explanation).slice(0, coverageMode === 'ai' ? 15 : customCount);
    if (questions.length < Math.min(3, count || 3)) throw new Error('The model did not return enough valid source-grounded questions.');
    const coveragePlan = (Array.isArray(parsed.coveragePlan) ? parsed.coveragePlan : []).map(item => {
      const sourceTitle = allowedNames.has(item?.sourceTitle) ? item.sourceTitle : selectedDocuments[0].name;
      const selection = selectionByName.get(sourceTitle);
      const requestedPage = Number(item?.sourcePage);
      const fallbackPage = selection?.pages ? [...selection.pages][0] : 0;
      return {
        concept: String(item?.concept || '').trim().slice(0, 120),
        importance: item?.importance === 'supporting' ? 'supporting' : 'essential',
        sourceTitle,
        sourcePage: selection?.pages?.has(requestedPage) ? requestedPage : fallbackPage,
      };
    }).filter(item => item.concept).slice(0, 24);
    const quiz = { id: crypto.randomUUID(), title: String(parsed.title || 'Source Focus Quiz').trim().slice(0, 100), difficulty, coverageMode, requestedCount: count, questionCount: questions.length, coveragePlan, questions, sourceTitles: selectedDocuments.map(document => document.name), scope: selections.map(({ documentId, name, pageRange, selectedPageCount }) => ({ documentId, name, pageRange, selectedPageCount })), generatedAt: new Date().toISOString(), submittedAt: null };
    await mutateStore(latestStore => {
      latestStore.quizzes = [quiz, ...(Array.isArray(latestStore.quizzes) ? latestStore.quizzes.filter(item => item.id !== quiz.id) : [])].slice(0, 20);
    });
    res.json({ quiz });
  } catch (error) {
    res.status(503).json({ error: 'Quiz generation failed: ' + error.message });
  }
}));

app.post('/api/quiz/:quizId/submit', asyncRoute(async (req, res) => {
  const answers = req.body?.answers && typeof req.body.answers === 'object' && !Array.isArray(req.body.answers) ? req.body.answers : {};
  const saved = await mutateStore(store => {
    const quiz = store.quizzes.find(item => item.id === req.params.quizId);
    if (!quiz) return null;
    if (quiz.submittedAt) return { error: 'This quiz attempt was already submitted.' };
    const profile = normalizeLearnerProfile(store.learnerProfile);
    const difficulty = quiz.difficulty === 'hard' ? 4 : quiz.difficulty === 'easy' ? 1 : 2;
    const outcomes = quiz.questions.map(question => {
      const selectedIndex = Number(answers[question.id]);
      const correct = Number.isInteger(selectedIndex) && selectedIndex === question.answerIndex;
      const concept = ensureConcept(profile, question.concept || 'Quiz practice');
      const classification = correct ? 'correct' : 'incorrect';
      const updatedConcept = applyLearningEvidence(profile, concept.id, {
        classification, confidence: 1,
        misconception: correct ? '' : 'The selected answer did not match the source-grounded relationship assessed in the quiz.',
        correction: question.explanation,
      }, { action: 'source-quiz', assessmentType: difficulty >= 4 ? 'transfer' : difficulty >= 2 ? 'application' : 'recall', difficulty, strategy: 'socratic' });
      store.learningEvents = appendLearningEvent(store.learningEvents, eventFromAssessment({ assessment: { classification, confidence: 1 }, concept: updatedConcept || concept, source: 'quiz', strategy: 'socratic', detail: 'Source-grounded quiz answer was ' + classification + '.' }));
      return { questionId: question.id, conceptId: concept.id, correct, selectedIndex, answerIndex: question.answerIndex };
    });
    quiz.submittedAt = new Date().toISOString();
    quiz.score = outcomes.filter(item => item.correct).length;
    quiz.answers = Object.fromEntries(outcomes.map(item => [item.questionId, item.selectedIndex]));
    store.learnerProfile = profile;
    const weakest = outcomes.find(item => !item.correct);
    const activeConceptId = weakest?.conceptId || outcomes[0]?.conceptId || null;
    const orchestrator = buildOrchestratorSnapshot({ learnerProfile: profile, learningEvents: store.learningEvents, activeConceptId });
    store.orchestratorHistory = [...store.orchestratorHistory, { id: crypto.randomUUID(), chatId: null, conceptId: activeConceptId, conceptLabel: orchestrator.activeConcept?.label || null, selectedAction: 'quiz-evidence', selectedStrategy: 'socratic', reason: 'A source-grounded quiz updated the learner model.', nextMove: orchestrator.nextMove, overridden: false, at: quiz.submittedAt }].slice(-120);
    return { quizId: quiz.id, score: quiz.score, questionCount: quiz.questions.length, percentage: Math.round(quiz.score / quiz.questions.length * 100), outcomes, learnerProfile: profile, summary: learnerSummary(profile), orchestrator };
  });
  if (!saved) return res.status(404).json({ error: 'Quiz attempt not found. Generate a new quiz and try again.' });
  if (saved.error) return res.status(409).json({ error: saved.error });
  res.json(saved);
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (!res.headersSent) res.status(500).json({ error: 'The server could not complete this request safely.' });
});

app.listen(port, () => console.log('QuizKatalyst API http://localhost:' + port));
