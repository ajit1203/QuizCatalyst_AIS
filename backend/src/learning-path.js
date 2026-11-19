import { conceptIdFromLabel } from './learner-model.js';

const safeText = (value, limit) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);

export function indexedSourceChunks(selections) {
  return selections.flatMap((selection, documentIndex) => selection.chunks.map((chunk, chunkIndex) => ({
    chunkId: 'd' + (documentIndex + 1) + '-c' + (chunkIndex + 1),
    documentId: selection.documentId,
    sourceTitle: selection.name,
    sourcePage: Number.isInteger(chunk.pageStart) ? chunk.pageStart : 0,
    content: safeText(chunk.content, 1400),
  }))).filter(chunk => chunk.content);
}

export function createChunkBatches(chunks, { maxChars = 16000, maxChunks = 24 } = {}) {
  const batches = [];
  let current = [];
  let characters = 0;
  chunks.forEach(chunk => {
    const size = chunk.content.length + chunk.sourceTitle.length + 80;
    if (current.length && (current.length >= maxChunks || characters + size > maxChars)) {
      batches.push(current); current = []; characters = 0;
    }
    current.push(chunk); characters += size;
  });
  if (current.length) batches.push(current);
  return batches;
}

export function deduplicateCandidates(candidates) {
  const result = new Map();
  candidates.forEach(candidate => {
    const key = conceptIdFromLabel(candidate.label);
    if (!key || key === 'general-study') return;
    const existing = result.get(key);
    const normalized = {
      ...candidate, id: key, label: safeText(candidate.label, 80), summary: safeText(candidate.summary, 300),
      importance: Math.max(1, Math.min(5, Number(candidate.importance) || 3)),
      prerequisiteLabels: [...new Set((candidate.prerequisiteLabels || []).map(label => safeText(label, 80)).filter(Boolean))].slice(0, 8),
      chunkIds: [...new Set((candidate.chunkIds || []).filter(Boolean))],
      sourceReferences: [{ sourceTitle: candidate.sourceTitle || '', sourcePage: Number(candidate.sourcePage) || 0 }],
    };
    if (!existing) result.set(key, normalized);
    else {
      existing.importance = Math.max(existing.importance, normalized.importance);
      existing.chunkIds = [...new Set([...existing.chunkIds, ...normalized.chunkIds])];
      existing.prerequisiteLabels = [...new Set([...existing.prerequisiteLabels, ...normalized.prerequisiteLabels])].slice(0, 8);
      existing.sourceReferences = [...existing.sourceReferences, ...normalized.sourceReferences].filter((ref, index, refs) => refs.findIndex(item => item.sourceTitle === ref.sourceTitle && item.sourcePage === ref.sourcePage) === index).slice(0, 8);
      if (normalized.summary.length > existing.summary.length) existing.summary = normalized.summary;
    }
  });
  return [...result.values()];
}

export function normalizeLearningPath(value, { documentIds = [], sourceTitles = [] } = {}) {
  const rawConcepts = Array.isArray(value?.concepts) ? value.concepts : [];
  const seen = new Set();
  const concepts = rawConcepts.map((item, index) => {
    let id = safeText(item?.id, 64).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'concept-' + (index + 1);
    while (seen.has(id)) id += '-' + (index + 1);
    seen.add(id);
    return {
      id,
      learnerConceptId: conceptIdFromLabel(item?.label),
      label: safeText(item?.label, 80) || 'Concept ' + (index + 1),
      summary: safeText(item?.summary, 320),
      order: index + 1,
      prerequisiteIds: Array.isArray(item?.prerequisiteIds) ? item.prerequisiteIds.map(entry => safeText(entry, 64).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean).slice(0, 5) : [],
      sourceTitle: sourceTitles.includes(item?.sourceTitle) ? item.sourceTitle : sourceTitles[0] || '',
      sourcePage: Math.max(0, Number.isInteger(item?.sourcePage) ? item.sourcePage : 0),
      moduleId: safeText(item?.moduleId, 64) || 'core',
      moduleLabel: safeText(item?.moduleLabel, 100) || 'Core concepts',
      importance: Math.max(1, Math.min(5, Number(item?.importance) || 3)),
      chunkIds: [...new Set((Array.isArray(item?.chunkIds) ? item.chunkIds : []).filter(id => typeof id === 'string'))].slice(0, 100),
      sourceReferences: Array.isArray(item?.sourceReferences) ? item.sourceReferences.filter(ref => ref && sourceTitles.includes(ref.sourceTitle)).map(ref => ({ sourceTitle: ref.sourceTitle, sourcePage: Math.max(0, Number(ref.sourcePage) || 0) })).slice(0, 8) : [],
    };
  }).filter(item => item.label).slice(0, 120);
  const ids = new Set(concepts.map(item => item.id));
  concepts.forEach(item => { item.prerequisiteIds = [...new Set(item.prerequisiteIds.filter(id => ids.has(id) && id !== item.id))]; });
  return {
    id: crypto.randomUUID(),
    title: safeText(value?.title, 100) || 'Personalized learning path',
    description: safeText(value?.description, 420),
    sourceDocumentIds: [...new Set(documentIds)],
    sourceTitles: [...new Set(sourceTitles)],
    modules: Array.isArray(value?.modules) ? value.modules.map((module, index) => ({ id: safeText(module?.id, 64) || 'module-' + (index + 1), label: safeText(module?.label, 100) || 'Module ' + (index + 1), summary: safeText(module?.summary, 320), importance: Math.max(1, Math.min(5, Number(module?.importance) || 3)) })).slice(0, 24) : [],
    indexing: value?.indexing && typeof value.indexing === 'object' ? value.indexing : null,
    concepts,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function learningPathProgress(path, learnerProfile, now = new Date()) {
  const items = (path?.concepts || []).map(item => {
    const evidence = learnerProfile?.concepts?.[item.learnerConceptId] || null;
    const mastery = evidence ? Number(evidence.mastery) || 0 : 0;
    const confidence = evidence ? Number(evidence.confidence) || 0 : 0;
    const status = evidence?.status || 'unassessed';
    return { ...item, mastery, confidence, status, attempts: evidence?.attempts || 0, nextReviewAt: evidence?.nextReviewAt || null };
  });
  const masteredCount = items.filter(item => item.status === 'mastered').length;
  const completion = items.length ? Math.round(masteredCount / items.length * 100) : 0;
  const due = items.find(item => item.nextReviewAt && new Date(item.nextReviewAt).getTime() <= now.getTime());
  let target = due;
  let action = due ? 'review' : null;
  if (!target) {
    target = items.find(item => item.status !== 'mastered' && item.prerequisiteIds.every(id => {
      const prerequisite = items.find(candidate => candidate.id === id);
      return !prerequisite || prerequisite.status === 'mastered' || prerequisite.mastery >= 0.62;
    }));
    if (target) action = target.attempts === 0 ? 'diagnostic' : target.mastery < 0.55 ? 'learn' : 'practice';
  }
  if (!target) target = items.find(item => item.status !== 'mastered') || null;
  if (!action && target) action = target.attempts === 0 ? 'diagnostic' : 'practice';
  const reason = action === 'review' ? 'Retention evidence is due for renewal.'
    : action === 'diagnostic' ? 'A quick check will establish the right starting level.'
      : action === 'learn' ? 'Current evidence shows this foundation needs rebuilding.'
        : action === 'practice' ? 'The foundation is present; application will strengthen it.'
          : 'Every mapped concept currently meets the mastery target.';
  const prompt = target ? (action === 'review' ? 'Review me on ' : action === 'diagnostic' ? 'Give me a short diagnostic on ' : action === 'practice' ? 'Give me an application exercise on ' : 'Teach me ') + target.label + ' using my uploaded sources.' : '';
  return { items, masteredCount, completion, recommendation: target ? { action, conceptId: target.id, learnerConceptId: target.learnerConceptId, label: target.label, reason, prompt } : { action: 'complete', conceptId: null, label: null, reason, prompt: '' } };
}
