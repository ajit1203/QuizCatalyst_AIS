import assert from 'node:assert/strict';
import { chunkRecord, documentMetadata, evenlySampleChunks, parsePageRanges, selectDocumentChunks } from '../src/source-documents.js';

const parsed = parsePageRanges('2-4, 7, 9-10', 12);
assert.deepEqual([...parsed.pages], [2, 3, 4, 7, 9, 10]);
assert.equal(parsed.label, 'Pages 2-4, 7, 9-10');
assert.throws(() => parsePageRanges('8-3', 12), /between 1 and 12/);
assert.throws(() => parsePageRanges('13', 12), /between 1 and 12/);
assert.throws(() => parsePageRanges('three', 12), /Invalid page range/);

assert.deepEqual(chunkRecord('legacy text'), { content: 'legacy text', pageStart: null, pageEnd: null });

const document = {
  id: 'document-1', name: 'Organic Chemistry.pdf', kind: 'pdf', pageCount: 10, wordCount: 50,
  chunks: Array.from({ length: 10 }, (_, index) => ({ content: 'Evidence from page ' + (index + 1), pageStart: index + 1, pageEnd: index + 1 })),
  uploadedAt: '2026-10-30T00:00:00.000Z',
};
const selection = selectDocumentChunks(document, '3-5, 9');
assert.equal(selection.pageRange, 'Pages 3-5, 9');
assert.equal(selection.selectedPageCount, 4);
assert.deepEqual(selection.chunks.map(chunk => chunk.pageStart), [3, 4, 5, 9]);
assert.deepEqual(documentMetadata(document), {
  id: 'document-1', name: 'Organic Chemistry.pdf', kind: 'pdf', pageCount: 10, wordCount: 50,
  chunkCount: 10, uploadedAt: '2026-10-30T00:00:00.000Z',
});

const sample = evenlySampleChunks(document.chunks, 4);
assert.deepEqual(sample.map(chunk => chunk.pageStart), [1, 4, 7, 10]);
console.log('source document tests passed');
