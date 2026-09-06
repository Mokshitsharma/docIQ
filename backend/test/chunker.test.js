import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages } from '../src/services/ingestion/chunker.js';

// Realistic prose: many short sentences so the packer (not the hard-splitter) runs.
const sentences = (n, wordsEach = 12) =>
  Array.from({ length: n }, (_, s) =>
    'Sent' + s + ' ' + Array.from({ length: wordsEach }, (_, i) => `w${s}x${i}`).join(' ') + '.'
  ).join(' ');
const para = (w) => sentences(Math.ceil(w / 12));

test('chunks respect approximate size and carry overlap', () => {
  const pages = [{ pageNumber: 1, text: sentences(120) }];
  const chunks = chunkPages(pages, { chunkSize: 200, chunkOverlap: 40 });
  assert.ok(chunks.length >= 3, 'should split into multiple chunks');
  for (const c of chunks) {
    assert.ok(c.tokenCount <= 260, `chunk not too big: ${c.tokenCount}`);
    assert.equal(c.pageNumber, 1);
  }
  // consecutive chunks from the same page should share some text (overlap)
  const a = new Set(chunks[0].text.split(' '));
  const shared = chunks[1].text.split(' ').filter((w) => a.has(w));
  assert.ok(shared.length > 0, 'expected overlap between consecutive chunks');
});

test('never merges text across page boundaries', () => {
  const pages = [
    { pageNumber: 1, text: para(50) },
    { pageNumber: 2, text: para(50) },
  ];
  const chunks = chunkPages(pages, { chunkSize: 800, chunkOverlap: 100 });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].pageNumber, 1);
  assert.equal(chunks[1].pageNumber, 2);
});

test('hard-splits an oversized single segment', () => {
  const pages = [{ pageNumber: 1, text: para(5000) }];
  const chunks = chunkPages(pages, { chunkSize: 300, chunkOverlap: 50 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.text.length > 0));
});

test('empty input yields no chunks', () => {
  assert.deepEqual(chunkPages([], {}), []);
  assert.deepEqual(chunkPages([{ pageNumber: 1, text: '   ' }], {}), []);
});
