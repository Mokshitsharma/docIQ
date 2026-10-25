/**
 * Choose the query-coverage refusal threshold on the DEV split only.
 *
 *   node eval/tune-gate.js   → eval/results/gate-tuning.json
 *
 * For each threshold on a 0.05 grid, compute dev overall accuracy (answerable:
 * correct answer; unanswerable: refusal) for every retriever/embedder run, and
 * pick the threshold with the highest mean across runs (ties → lower threshold).
 * The chosen value is then hard-coded as MIN_COVERAGE in eval/eval.js and
 * DEFAULT_MIN_QUERY_COVERAGE in src/config/index.js; test questions are never used.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEval } from './eval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV = path.join(__dirname, 'datasets', 'dev-qa.json');
const OUT = path.join(__dirname, 'results', 'gate-tuning.json');

const res = await runEval({ datasetPath: DEV, minCoverage: 0 });
const grid = Array.from({ length: 20 }, (_, i) => Number((i * 0.05).toFixed(2)));
const table = grid.map((t) => {
  const perRun = {};
  for (const [name, rows] of Object.entries(res.rowsByRun)) {
    const ok = rows.map((r) => (r.coverage < t ? !r.answerable : r.correct));
    const ans = rows.filter((r) => r.answerable);
    const un = rows.filter((r) => !r.answerable);
    perRun[name] = {
      overall: ok.filter(Boolean).length / rows.length,
      answer: ans.filter((r) => r.coverage >= t && r.correct).length / ans.length,
      refusal: un.filter((r) => r.coverage < t || r.refused).length / un.length,
    };
  }
  const vals = Object.values(perRun);
  const mean = (k) => Number((vals.reduce((a, v) => a + v[k], 0) / vals.length).toFixed(4));
  return { threshold: t, meanOverall: mean('overall'), meanAnswer: mean('answer'), meanRefusal: mean('refusal') };
});
const best = table.reduce((b, r) => (r.meanOverall > b.meanOverall ? r : b), table[0]);
const out = {
  dataset: { path: 'eval/datasets/dev-qa.json', questions: res.dataset.questions, answerable: res.dataset.answerable, unanswerable: res.dataset.unanswerable },
  rule: 'refuse if queryCoverage(question, top-5 chunks) < threshold',
  selection: 'max mean dev overall accuracy across all retriever/embedder runs; ties -> lower threshold',
  chosen: best.threshold,
  grid: table,
};
await fs.writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
for (const r of table) console.log(r.threshold.toFixed(2), 'overall', r.meanOverall, 'answer', r.meanAnswer, 'refusal', r.meanRefusal);
console.log('chosen threshold:', best.threshold);
