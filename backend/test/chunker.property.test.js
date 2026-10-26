import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { chunkPages } from '../src/services/ingestion/chunker.js';
import { estimateTokens } from '../src/utils/tokens.js';

// Property tests (fixed seed → deterministic).
const SEED = 42;
const word = fc.stringMatching(/^[A-Za-z0-9$,]{1,12}$/);
const sentence = fc.array(word, { minLength: 1, maxLength: 25 }).map((w) => w.join(' ') + '.');
const pageText = fc.array(sentence, { minLength: 0, maxLength: 60 }).map((s) => s.join(' '));
const pages = fc.array(pageText, { minLength: 1, maxLength: 4 }).map((ts) => ts.map((text, i) => ({ pageNumber: i + 1, text })));
const opts = fc.record({ chunkSize: fc.integer({ min: 20, max: 400 }), chunkOverlap: fc.integer({ min: 0, max: 200 }) });

test('every word of the input appears in some chunk of its own page (no text lost)', () => {
  fc.assert(
    fc.property(pages, opts, (ps, o) => {
      const chunks = chunkPages(ps, o);
      for (const p of ps) {
        const text = chunks.filter((c) => c.pageNumber === p.pageNumber).map((c) => c.text).join(' ');
        for (const w of p.text.split(/\s+/).filter(Boolean)) assert.ok(text.includes(w), w);
      }
    }),
    { seed: SEED, numRuns: 200 }
  );
});

test('ordinals are 0..n-1, pages non-decreasing, no empty chunks, chunk text comes from its page', () => {
  fc.assert(
    fc.property(pages, opts, (ps, o) => {
      const chunks = chunkPages(ps, o);
      chunks.forEach((c, i) => {
        assert.equal(c.ordinal, i);
        assert.ok(c.text.trim().length > 0);
        if (i) assert.ok(c.pageNumber >= chunks[i - 1].pageNumber);
        const src = ps.find((p) => p.pageNumber === c.pageNumber).text.replace(/\s+/g, ' ');
        for (const w of c.text.split(/\s+/)) assert.ok(src.includes(w));
      });
    }),
    { seed: SEED, numRuns: 200 }
  );
});

test('chunks stay within a bounded multiple of chunkSize', () => {
  fc.assert(
    fc.property(pages, opts, (ps, o) => {
      for (const c of chunkPages(ps, o)) assert.ok(estimateTokens(c.text) <= o.chunkSize * 2 + 20, `${estimateTokens(c.text)} > ${o.chunkSize}`);
    }),
    { seed: SEED, numRuns: 200 }
  );
});

test('deterministic: same input → same chunks', () => {
  fc.assert(
    fc.property(pages, opts, (ps, o) => assert.deepEqual(chunkPages(ps, o), chunkPages(ps, o))),
    { seed: SEED, numRuns: 50 }
  );
});
