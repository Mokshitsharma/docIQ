/**
 * SYNTHETIC question generator (template-based, no LLM, deterministic).
 *
 *   node eval/synth.js   → eval/datasets/synthetic-dev.json, eval/datasets/synthetic-test.json
 *
 * Why: the 71 hand-written questions cannot detect a 5-point hit@5 difference
 * between retrievers (see the power analysis in the eval report). These
 * synthetic questions add answerable items so retrieval metrics have more power.
 *
 * How: for each corpus sentence of 10–60 words, the answer is a 3-word span near
 * the end of the sentence; the question is "What does the document say about
 * <up to 6 content words from the rest of the sentence>?". Evidence = the
 * 8 words ending in the answer span (verbatim). Items are dropped unless the evidence
 * occurs in 1-2 chunks (2 = chunk-overlap region) of its own document only.
 *
 * Limitations (stated in the report): keyword-bag questions favour lexical
 * retrievers (BM25); there are no synthetic unanswerable items. Synthetic
 * metrics are reported separately from the hand-written set and never mixed.
 * Split: 50/50 dev/test by a seeded hash of the item id.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadDataset, buildChunks, isRelevant, normalize } from './eval.js';
import { mulberry32 } from './lib/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED = 20261027;
const PER_DOC_MAX = 400;

const STOP = new Set(
  ('the a an and or of to for in on at is are was were be been being by with as it its this that these those ' +
    'what which who whom whose how when where why do does did will would shall should can could may might must ' +
    'have has had not no if then than so such about into over under any all each other under from upon such').split(' ')
);

const words = (s) => s.split(/\s+/).filter(Boolean);
const clean = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '');

function sentences(text) {
  return text
    .replace(/\r/g, '')
    .split(/\n+/)
    .flatMap((p) => p.split(/(?<=[.;])\s+(?=[A-Z(])/))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => {
      const n = words(s).length;
      return n >= 10 && n <= 60;
    });
}

export async function generate() {
  const { sources } = await loadDataset();
  const chunks = await buildChunks(sources);
  const rng = mulberry32(SEED);
  const items = [];
  for (const s of sources) {
    const text = await fs.readFile(path.join(__dirname, 'corpus', s.file), 'utf8');
    const seen = new Set();
    let made = 0;
    for (const sent of sentences(text)) {
      if (made >= PER_DOC_MAX) break;
      const w = words(sent);
      // answer span: 3 words ending 1-3 words before the sentence end, all with letters, not all stopwords
      const end = w.length - 1 - Math.floor(rng() * 3);
      const span = w.slice(end - 2, end + 1);
      if (span.some((x) => !/[a-z0-9]{2,}/i.test(x)) || STOP.has(clean(span[2]))) continue;
      const answer = span.join(' ').replace(/^[^a-z0-9$]+|[^a-z0-9%)]+$/gi, '');
      if (answer.length < 8) continue;
      const evidence = w.slice(Math.max(0, end - 7), end + 1).join(' ').replace(/[^a-z0-9%)]+$/i, '');
      const spanSet = new Set(span.map(clean));
      const pool = [...new Set(w.slice(0, end - 2).map(clean).filter((x) => x.length > 3 && !STOP.has(x) && !spanSet.has(x)))];
      if (pool.length < 3) continue;
      // seeded pick of up to 6 keywords, kept in sentence order
      const kw = pool
        .map((x, i) => ({ x, i, r: rng() }))
        .sort((a, b) => a.r - b.r)
        .slice(0, 6)
        .sort((a, b) => a.i - b.i)
        .map((o) => o.x);
      const question = `What does the document say about ${kw.join(' ')}?`;
      const key = normalize(evidence);
      if (seen.has(key)) continue;
      // evidence must be unique to this document and fall inside one chunk
      if (sources.some((o) => o.id !== s.id && chunks.some((c) => c.docId === o.id && normalize(c.text).includes(key)))) continue;
      const item = { id: `syn-${s.id}-${String(made + 1).padStart(3, '0')}`, docId: s.id, question, evidence: [evidence], answers: [answer], synthetic: true };
      // at most 2 chunks hold the evidence (2 = the chunk-overlap region), so relevance is near-unambiguous
      const holders = chunks.filter((c) => isRelevant(c, item)).length;
      if (holders < 1 || holders > 2) continue;
      seen.add(key);
      items.push(item);
      made++;
    }
  }
  const split = (id) => (crypto.createHash('sha256').update(`${SEED}:${id}`).digest()[0] < 128 ? 'dev' : 'test');
  return { dev: items.filter((i) => split(i.id) === 'dev'), test: items.filter((i) => split(i.id) === 'test') };
}

async function main() {
  const { dev, test } = await generate();
  for (const [name, cases] of [['dev', dev], ['test', test]]) {
    const out = {
      name: `synthetic-${name}`,
      version: 1,
      synthetic: true,
      description:
        `SYNTHETIC (template-generated by eval/synth.js, seed ${SEED}; not hand-written). ${name} split. ` +
        'Keyword-bag questions over the same public corpus; answerable only. Report separately from public-docs-qa.',
      cases,
    };
    const p = path.join(__dirname, 'datasets', `synthetic-${name}.json`);
    await fs.writeFile(p, JSON.stringify(out, null, 1) + '\n');
    console.log(`wrote ${path.relative(process.cwd(), p)}: ${cases.length} synthetic questions`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
