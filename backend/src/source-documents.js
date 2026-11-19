import pdf from 'pdf-parse';

export function splitSourceText(text, size = 850) {
  return String(text || '').replace(/\s+/g, ' ').trim().match(new RegExp('.{1,' + size + '}(?:\\s|$)', 'g')) || [];
}

function pageTextFromContent(content) {
  let lastY = null;
  let text = '';
  for (const item of content?.items || []) {
    const y = item?.transform?.[5];
    if (lastY !== null && typeof y === 'number' && Math.abs(y - lastY) > 4) text += '\n';
    else if (text && !text.endsWith('\n')) text += ' ';
    text += String(item?.str || '');
    if (typeof y === 'number') lastY = y;
  }
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export async function createStudyDocument({ buffer, mimetype, name }) {
  const isPdf = mimetype === 'application/pdf' || /\.pdf$/i.test(name || '');
  const uploadedAt = new Date().toISOString();
  if (!isPdf) {
    const text = buffer.toString();
    if (!text.trim()) throw new Error('No readable text found');
    const chunks = splitSourceText(text).map(content => ({ content, pageStart: null, pageEnd: null }));
    return { id: crypto.randomUUID(), name, kind: 'text', pageCount: null, wordCount: text.trim().split(/\s+/).length, chunks, uploadedAt };
  }
  const pages = [];
  const parsed = await pdf(buffer, {
    pagerender: async pageData => {
      const content = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      const text = pageTextFromContent(content);
      pages.push(text);
      return text + '\n';
    },
  });
  if (!pages.length && parsed.text?.trim()) pages.push(parsed.text.trim());
  if (!pages.some(text => text.trim())) throw new Error('No readable text found. This PDF may be scanned and require OCR.');
  const chunks = pages.flatMap((text, index) => splitSourceText(text).map(content => ({ content, pageStart: index + 1, pageEnd: index + 1 })));
  return {
    id: crypto.randomUUID(), name, kind: 'pdf', pageCount: pages.length,
    wordCount: pages.join(' ').trim().split(/\s+/).filter(Boolean).length,
    chunks, uploadedAt,
  };
}

export function documentMetadata(document) {
  return {
    id: document.id,
    name: document.name,
    kind: document.kind || (document.pageCount ? 'pdf' : 'text'),
    pageCount: Number.isInteger(document.pageCount) ? document.pageCount : null,
    wordCount: Number.isInteger(document.wordCount) ? document.wordCount : null,
    chunkCount: Array.isArray(document.chunks) ? document.chunks.length : 0,
    uploadedAt: document.uploadedAt || null,
  };
}

export function chunkRecord(chunk) {
  if (typeof chunk === 'string') return { content: chunk, pageStart: null, pageEnd: null };
  return {
    content: typeof chunk?.content === 'string' ? chunk.content : '',
    pageStart: Number.isInteger(chunk?.pageStart) ? chunk.pageStart : null,
    pageEnd: Number.isInteger(chunk?.pageEnd) ? chunk.pageEnd : Number.isInteger(chunk?.pageStart) ? chunk.pageStart : null,
  };
}

export function parsePageRanges(value, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1) return { pages: null, label: 'All content' };
  const input = String(value || '').trim();
  if (!input || input.toLowerCase() === 'all') return { pages: new Set(Array.from({ length: pageCount }, (_, index) => index + 1)), label: 'Pages 1-' + pageCount };
  const pages = new Set();
  for (const part of input.split(',').map(item => item.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('Invalid page range "' + part + '". Use formats such as 4-12 or 4-12, 18, 22-25.');
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > pageCount) throw new Error('Page range "' + part + '" must stay between 1 and ' + pageCount + '.');
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  if (!pages.size) throw new Error('Choose at least one page.');
  const sorted = [...pages].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = start;
  for (const page of sorted.slice(1)) {
    if (page === end + 1) end = page;
    else { ranges.push(start === end ? String(start) : start + '-' + end); start = page; end = page; }
  }
  ranges.push(start === end ? String(start) : start + '-' + end);
  return { pages, label: 'Pages ' + ranges.join(', ') };
}

export function selectDocumentChunks(document, rangeValue) {
  const selection = parsePageRanges(rangeValue, document.pageCount);
  const chunks = (Array.isArray(document.chunks) ? document.chunks : [])
    .map(chunkRecord)
    .filter(chunk => chunk.content.trim())
    .filter(chunk => !selection.pages || (Number.isInteger(chunk.pageStart) && selection.pages.has(chunk.pageStart)));
  return {
    documentId: document.id,
    name: document.name,
    pageRange: selection.label,
    selectedPageCount: selection.pages?.size || null,
    pages: selection.pages,
    chunks,
  };
}

export function evenlySampleChunks(chunks, limit) {
  if (chunks.length <= limit) return chunks;
  if (limit <= 1) return [chunks[0]];
  const picked = [];
  const used = new Set();
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round(index * (chunks.length - 1) / (limit - 1));
    if (!used.has(sourceIndex)) { picked.push(chunks[sourceIndex]); used.add(sourceIndex); }
  }
  return picked;
}

