import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BM25Index, bm25Tokenize } from '../src/services/retrieval/bm25.js';
import { rankCandidates } from '../src/services/retrieval/retriever.js';
import { generateGroundedAnswer, REFUSAL } from '../src/services/query/answerer.js';
import { ExtractiveProvider } from '../src/services/llm/extractive.js';

const texts = [
  'The Government will pay invoices on the 30th day after receipt of a proper invoice.',
  'Either party may terminate for convenience with ninety days written notice.',
  'Gifts of $20 or less per source per occasion may be accepted.',
];

test('bm25 tokenizer keeps dollar amounts and drops stopwords', () => {
  assert.deepEqual(bm25Tokenize('Gifts of $20 or less.'), ['gifts', '$20', 'less']);
});

test('bm25 ranks the lexically matching document first', () => {
  const idx = new BM25Index(texts);
  assert.equal(idx.search('terminate for convenience notice', 3)[0].index, 1);
  assert.equal(idx.search('$20 gifts', 3)[0].index, 2);
  assert.deepEqual(idx.search('zebra', 3), [], 'no-overlap query returns nothing');
});

test('bm25 rare terms get higher idf than common ones', () => {
  const idx = new BM25Index(['invoice alpha', 'invoice beta', 'invoice gamma']);
  assert.ok(idx.idf('alpha') > idx.idf('invoice'));
});

test('rankCandidates: hybrid can reorder vector ties by keyword overlap', () => {
  const candidates = texts.map((text) => ({ chunk: { text }, vectorScore: 0.5 }));
  const vec = rankCandidates('terminate convenience', candidates, { strategy: 'vector', topK: 3 });
  const hyb = rankCandidates('terminate convenience', candidates, { strategy: 'hybrid', topK: 3 });
  assert.equal(vec[0].score, 0.5);
  assert.equal(hyb[0].chunk.text, texts[1]);
  assert.ok(hyb[0].score > 0.5);
});

test('generateGroundedAnswer refuses below threshold without calling the LLM', async () => {
  const llm = { name: 'spy', complete: () => assert.fail('LLM must not be called') };
  const out = await generateGroundedAnswer({
    question: 'anything',
    chunks: [{ text: 'x', pageNumber: 1, score: 0.1 }],
    llm,
    threshold: 0.15,
  });
  assert.equal(out.answer, REFUSAL);
  assert.equal(out.grounded, false);
});

test('generateGroundedAnswer maps citations back to chunks (extractive LLM)', async () => {
  const chunks = texts.map((text, i) => ({ text, pageNumber: 1, score: 0.9 - i * 0.1 }));
  const out = await generateGroundedAnswer({
    question: 'When will the Government pay invoices?',
    chunks,
    llm: new ExtractiveProvider(),
  });
  assert.equal(out.grounded, true);
  assert.match(out.answer, /30th day/);
  assert.equal(out.citations[0].chunk, chunks[0]);
});
