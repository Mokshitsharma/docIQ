/**
 * Retrieval + answer eval over public-domain documents. No MongoDB / Redis / API key needed.
 *
 *   npm run eval                       # run, print tables, write eval/results/public-docs-qa.json
 *   npm run eval -- --check            # re-run and fail if results differ from the committed JSON
 *   npm run eval -- --embedders local  # skip the MiniLM runs (no model download)
 *   npm run eval -- --llm groq         # answer with an LLM (needs its key in backend/.env)
 *
 * Pipeline (same code as the API): eval/corpus/*.txt → parser → chunker (app
 * default chunk size/overlap) → embeddings → MemoryVectorStore / BM25 →
 * rankCandidates() → generateGroundedAnswer() with the configured LLM.
 *
 * Retrievers compared (ablation):
 *   bm25        Okapi BM25 over every chunk (src/services/retrieval/bm25.js)
 *   vector      cosine similarity only (app strategy "vector")
 *   hybrid      app strategy "hybrid": vector top-4k, re-scored 0.7·vector + 0.3·BM25-lite
 *   hybrid-rrf  reciprocal-rank fusion (k=60) of full BM25 and full vector rankings (eval-only)
 * each with the `local` hashed bag-of-words embedder (app default) and, if
 * installed, `minilm` (all-MiniLM-L6-v2).
 *
 * Metrics (bootstrap 95% CI, 10k resamples, fixed seed):
 *   hit@k   answerable questions whose gold evidence span is inside a top-k chunk of the gold doc
 *   mrr@5   mean reciprocal rank of the first relevant chunk (0 if not in top 5)
 *   answer accuracy   answerable: not refused AND answer contains a gold string
 *   refusal accuracy  unanswerable: answer is the refusal
 *   overall accuracy  all questions, each scored as above
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../src/services/ingestion/parser.js';
import { chunkPages } from '../src/services/ingestion/chunker.js';
import { LocalEmbeddingProvider } from '../src/services/embedding/local.js';
import { MiniLMEmbeddingProvider, isMiniLMAvailable } from '../src/services/embedding/minilm.js';
import { getLLMProvider } from '../src/services/llm/index.js';
import { MemoryVectorStore } from '../src/services/retrieval/vectorStore.js';
import { BM25Index } from '../src/services/retrieval/bm25.js';
import {
  rankCandidates,
  clamp01,
  HYBRID_OVERFETCH,
  HYBRID_WEIGHTS,
} from '../src/services/retrieval/retriever.js';
import { generateGroundedAnswer } from '../src/services/query/answerer.js';
import {
  bootstrapMean,
  pairedBootstrapDiff,
  firstRelevantRank,
  hitAt,
  reciprocalRank,
} from './lib/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATASET_PATH = path.join(__dirname, 'datasets', 'public-docs-qa.json');
export const RESULTS_PATH = path.join(__dirname, 'results', 'public-docs-qa.json');
const CORPUS_DIR = path.join(__dirname, 'corpus');

const TOP_K = 5;
const KS = [1, 3, 5];
const RRF_K = 60;
const BOOT = { resamples: 10000, seed: 1234, alpha: 0.05 };
// Fixed here (not read from .env) so committed results are reproducible.
// These equal the app defaults (DEFAULT_CHUNK_SIZE / DEFAULT_CHUNK_OVERLAP / DEFAULT_CONFIDENCE_THRESHOLD).
const CHUNK = { chunkSize: 800, chunkOverlap: 100 };
const THRESHOLD = 0.15;

export const normalize = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

export async function loadDataset() {
  const spec = JSON.parse(await fs.readFile(DATASET_PATH, 'utf8'));
  const sources = JSON.parse(await fs.readFile(path.join(CORPUS_DIR, 'SOURCES.json'), 'utf8'));
  return { spec, sources };
}

export async function buildChunks(sources) {
  const chunks = [];
  for (const s of sources) {
    const { pages } = await parseDocument(path.join(CORPUS_DIR, s.file), 'txt');
    // Normalise CRLF in case git checked the snapshot out with Windows line endings.
    const clean = pages.map((p) => ({ ...p, text: p.text.replace(/\r/g, '') }));
    for (const c of chunkPages(clean, CHUNK)) chunks.push({ ...c, docId: s.id, idx: chunks.length });
  }
  return chunks;
}

function makeRetrievers(chunks, bm25, store) {
  const asCandidate = (h) => ({ chunk: chunks[Number(h.id)], vectorScore: clamp01((h.score + 1) / 2) });

  return {
    bm25: {
      gate: false,
      run: async (q) => bm25.search(q, TOP_K).map((r) => ({ chunk: chunks[r.index], score: r.score })),
    },
    vector: {
      gate: true,
      run: async (q, qVec) =>
        rankCandidates(q, (await store.query(qVec, { topK: TOP_K })).map(asCandidate), {
          strategy: 'vector',
          topK: TOP_K,
        }),
    },
    hybrid: {
      gate: true,
      run: async (q, qVec) =>
        rankCandidates(q, (await store.query(qVec, { topK: TOP_K * HYBRID_OVERFETCH })).map(asCandidate), {
          strategy: 'hybrid',
          topK: TOP_K,
        }),
    },
    'hybrid-rrf': {
      gate: false,
      run: async (q, qVec) => {
        const fused = new Map();
        const add = (idx, rank) => fused.set(idx, (fused.get(idx) || 0) + 1 / (RRF_K + rank));
        bm25.search(q, chunks.length).forEach((r, i) => add(r.index, i + 1));
        (await store.query(qVec, { topK: chunks.length })).forEach((h, i) => add(Number(h.id), i + 1));
        return [...fused.entries()]
          .sort((a, b) => b[1] - a[1] || a[0] - b[0])
          .slice(0, TOP_K)
          .map(([idx, score]) => ({ chunk: chunks[idx], score }));
      },
    },
  };
}

export function isRelevant(chunk, c) {
  if (chunk.docId !== c.docId) return false;
  const body = normalize(chunk.text);
  return c.evidence.some((e) => body.includes(normalize(e)));
}

function summarize(perQ) {
  const ans = perQ.filter((r) => r.answerable);
  const unans = perQ.filter((r) => !r.answerable);
  const retrieval = {};
  for (const k of KS) retrieval[`hit@${k}`] = bootstrapMean(ans.map((r) => hitAt(r.rank, k)), BOOT);
  retrieval['mrr@5'] = bootstrapMean(ans.map((r) => reciprocalRank(r.rank)), BOOT);
  return {
    retrieval,
    answers: {
      answerAccuracy: bootstrapMean(ans.map((r) => (r.correct ? 1 : 0)), BOOT),
      refusalAccuracy: bootstrapMean(unans.map((r) => (r.correct ? 1 : 0)), BOOT),
      overallAccuracy: bootstrapMean(perQ.map((r) => (r.correct ? 1 : 0)), BOOT),
      falseRefusalRate: bootstrapMean(ans.map((r) => (r.refused ? 1 : 0)), BOOT),
    },
  };
}

export async function runEval({ embedders = ['local', 'minilm'], llmName = 'extractive', log = () => {} } = {}) {
  const { spec, sources } = await loadDataset();
  const chunks = await buildChunks(sources);
  const cases = spec.cases.map((c) => ({ ...c, answerable: Boolean(c.docId) }));

  // Evidence spans that the chunker split across a boundary can never be hit.
  const unreachable = cases
    .filter((c) => c.answerable && !chunks.some((ch) => isRelevant(ch, c)))
    .map((c) => c.id);

  const notProduced = [];
  const llm = getLLMProvider(llmName);
  if (llm.name !== llmName) {
    notProduced.push(`answers with LLM "${llmName}": provider unavailable (missing API key?); used "${llm.name}"`);
  }
  if (llm.name === 'extractive') {
    notProduced.push(
      'LLM-generated answer accuracy (gemini/groq/openai): not run — no API key configured; answers come from the extractive (no-LLM) provider'
    );
  }

  const embedderObjs = {};
  for (const name of embedders) {
    if (name === 'local') embedderObjs.local = new LocalEmbeddingProvider(384);
    else if (name === 'minilm') {
      if (await isMiniLMAvailable()) embedderObjs.minilm = new MiniLMEmbeddingProvider();
      else notProduced.push('minilm runs: @huggingface/transformers not installed');
    } else throw new Error(`unknown embedder ${name}`);
  }

  const bm25 = new BM25Index(chunks.map((c) => c.text));
  const runs = [];
  const perQuestion = {};
  const answerable = new Map(cases.map((c) => [c.id, c.answerable]));

  const evaluate = async (name, retriever, embedder) => {
    const rows = [];
    for (const c of cases) {
      const qVec = embedder ? (await embedder.embed([c.question]))[0] : null;
      const ranked = await retriever.run(c.question, qVec);
      const rank = c.answerable ? firstRelevantRank(ranked.map((r) => isRelevant(r.chunk, c))) : null;
      const out = await generateGroundedAnswer({
        question: c.question,
        chunks: ranked.map((r) => ({ ...r.chunk, score: r.score })),
        llm,
        threshold: retriever.gate ? THRESHOLD : -Infinity,
        docNameOf: (ch) => ch.docId,
      });
      const refused = !out.grounded;
      const correct = c.answerable
        ? !refused && c.answers.some((a) => normalize(out.answer).includes(normalize(a)))
        : refused;
      rows.push({ id: c.id, answerable: c.answerable, rank, refused, correct });
    }
    perQuestion[name] = rows.map(({ answerable: _a, ...r }) => r);
    runs.push({ name, ...summarize(rows) });
    log(`  ran ${name}`);
  };

  await evaluate('bm25', makeRetrievers(chunks, bm25, null).bm25, null);
  for (const [ename, embedder] of Object.entries(embedderObjs)) {
    const vectors = await embedder.embed(chunks.map((c) => c.text));
    const store = new MemoryVectorStore();
    await store.upsert(chunks.map((c, i) => ({ id: String(i), vector: vectors[i], metadata: {} })));
    const rs = makeRetrievers(chunks, bm25, store);
    for (const r of ['vector', 'hybrid', 'hybrid-rrf']) await evaluate(`${r}:${ename}`, rs[r], embedder);
  }

  // Paired comparisons on the same questions.
  const outcome = (name, metric) =>
    metric === 'hit@5'
      ? perQuestion[name].filter((r) => answerable.get(r.id)).map((r) => hitAt(r.rank, 5))
      : perQuestion[name].map((r) => (r.correct ? 1 : 0));
  const comparisons = [];
  for (const ename of Object.keys(embedderObjs)) {
    for (const [a, b] of [
      [`hybrid:${ename}`, `vector:${ename}`],
      [`hybrid:${ename}`, 'bm25'],
      [`hybrid-rrf:${ename}`, `vector:${ename}`],
      [`hybrid-rrf:${ename}`, 'bm25'],
    ]) {
      for (const metric of ['hit@5', 'overallAccuracy']) {
        comparisons.push({ a, b, metric, ...pairedBootstrapDiff(outcome(a, metric), outcome(b, metric), BOOT) });
      }
    }
  }

  return {
    dataset: {
      name: spec.name,
      version: spec.version,
      questions: cases.length,
      answerable: cases.filter((c) => c.answerable).length,
      unanswerable: cases.filter((c) => !c.answerable).length,
      documents: sources.map((s) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        url: s.url,
        license: s.license,
        sha256Text: s.sha256Text,
        questions: cases.filter((c) => c.docId === s.id).length,
      })),
    },
    config: {
      chunking: { ...CHUNK, chunks: chunks.length, note: 'app defaults (DEFAULT_CHUNK_SIZE/OVERLAP)' },
      topK: TOP_K,
      ks: KS,
      llm: llm.name,
      confidenceThreshold: {
        value: THRESHOLD,
        appliedTo: ['vector', 'hybrid'],
        note: 'bm25 and hybrid-rrf scores are not on the app 0-1 scale, so no score gate; refusal comes from the answer step only',
      },
      hybrid: { overFetch: `${HYBRID_OVERFETCH}x topK`, weights: HYBRID_WEIGHTS, keyword: 'BM25-lite over the over-fetched candidates' },
      rrf: { k: RRF_K },
      bm25: { k1: 1.2, b: 0.75 },
      embedders: Object.fromEntries(
        Object.entries(embedderObjs).map(([k, e]) => [
          k,
          k === 'minilm' ? e.model : 'hashed bag-of-words + char trigrams, 384-d',
        ])
      ),
      bootstrap: { method: 'percentile', resamples: BOOT.resamples, seed: BOOT.seed, ci: 1 - BOOT.alpha },
      answerScoring: 'case/whitespace-insensitive substring match of a gold answer string in a non-refusal answer',
    },
    unreachableEvidence: unreachable,
    notProduced,
    runs,
    comparisons,
    perQuestion,
  };
}

const pct = (m) => (m.value === null ? '  n/a' : `${(m.value * 100).toFixed(1)}`.padStart(5));
const ci = (m) => (m.value === null ? '' : `[${(m.ci[0] * 100).toFixed(1)}-${(m.ci[1] * 100).toFixed(1)}]`);

export function formatTable(results) {
  const cell = (m) => `${pct(m)} ${ci(m).padEnd(12)}`;
  const lines = [
    'retriever          hit@1              hit@3              hit@5              mrr@5  answer acc         refusal acc        overall acc',
  ];
  for (const r of results.runs) {
    lines.push(
      `${r.name.padEnd(18)} ${cell(r.retrieval['hit@1'])} ${cell(r.retrieval['hit@3'])} ${cell(r.retrieval['hit@5'])} ${r.retrieval['mrr@5'].value.toFixed(3)}  ${cell(r.answers.answerAccuracy)} ${cell(r.answers.refusalAccuracy)} ${cell(r.answers.overallAccuracy)}`
    );
  }
  return lines.join('\n');
}

const stable = (r) => JSON.stringify({ ...r, meta: undefined });

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const check = args.includes('--check');
  const embedders = (opt('--embedders') || 'local,minilm').split(',').filter(Boolean);
  const llmName = opt('--llm') || 'extractive';
  const out = opt('--out') || RESULTS_PATH;

  const t0 = Date.now();
  console.log('\nDocIQ eval — public-docs-qa');
  const results = await runEval({ embedders, llmName, log: console.log });
  results.meta = { generatedBy: 'node eval/eval.js', node: process.version, durationMs: Date.now() - t0 };

  const d = results.dataset;
  console.log(
    `\n  ${d.questions} questions (${d.answerable} answerable, ${d.unanswerable} unanswerable) over ${d.documents.length} documents, ${results.config.chunking.chunks} chunks, llm=${results.config.llm}`
  );
  if (results.unreachableEvidence.length) {
    console.log(`  evidence split across chunks (counted as misses): ${results.unreachableEvidence.join(', ')}`);
  }
  console.log('  values in %, bootstrap 95% CI in brackets\n');
  console.log(formatTable(results));
  console.log('\n  paired differences (a - b, 95% CI):');
  for (const c of results.comparisons) {
    console.log(
      `    ${`${c.a} - ${c.b}`.padEnd(36)} ${c.metric.padEnd(16)} ${(c.diff * 100).toFixed(1).padStart(6)} pts  [${(c.ci[0] * 100).toFixed(1)}, ${(c.ci[1] * 100).toFixed(1)}]`
    );
  }
  for (const n of results.notProduced) console.log(`  NOT PRODUCED: ${n}`);

  if (check) {
    const committed = JSON.parse(await fs.readFile(RESULTS_PATH, 'utf8'));
    if (stable(committed) !== stable(results)) {
      console.error('\n  CHECK FAILED: results differ from', path.relative(process.cwd(), RESULTS_PATH));
      process.exit(1);
    }
    console.log('\n  CHECK OK: results match the committed JSON');
    return;
  }
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(results, null, 2) + '\n');
  console.log(`\n  wrote ${path.relative(process.cwd(), out)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
