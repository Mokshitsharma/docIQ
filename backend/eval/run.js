/**
 * `npm run eval` — full, reproducible evaluation run in the shared results/ layout.
 *
 *   node eval/run.js [--embedders local,minilm] [--name eval] [--no-readme]
 *
 * Datasets
 *   test       eval/datasets/public-docs-qa.json   hand-written, 71 q  (REPORTED)
 *   syn-test   eval/datasets/synthetic-test.json   SYNTHETIC, answerable only (REPORTED separately)
 *   dev        eval/datasets/dev-qa.json + synthetic-dev.json  (power analysis inputs only; never reported as results)
 *
 * Writes (repo root)
 *   results/runs/<YYYYMMDD-HHMMSS>-<name>/{manifest.json, metrics.json, items.jsonl, report.md}
 *   results/index.sqlite   (runs, metrics)     results/latest.json     results/TRENDS.md
 *   backend/eval/results/public-docs-qa.json   (legacy file checked by `npm run eval:check`)
 *   README.md block between <!-- RESULTS:START --> and <!-- RESULTS:END -->
 *
 * Every metric: {value, ci_low, ci_high, n}; 95% percentile bootstrap, 10,000 resamples, seed 1234.
 * Answer metrics use the app's refusal behaviour (confidence gate + query-coverage gate 0.30).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { runEval, RESULTS_PATH, MIN_COVERAGE } from './eval.js';
import { bootstrapMean, pairedBootstrapDiff, hitAt } from './lib/metrics.js';
import { mcnemarExact, mcnemarSampleSize, mcnemarDetectableDelta, clopperPearson, bootstrapQuantile } from './lib/stats.js';
import { estimateCostUsd, PRICES } from '../src/services/query/usage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const ROOT = path.resolve(BACKEND, '..');
const RESULTS = path.join(ROOT, 'results');
const DS = (f) => path.join(__dirname, 'datasets', f);
const BOOT = { resamples: 10000, seed: 1234, alpha: 0.05 };
const THRESHOLDS_PATH = path.join(__dirname, 'thresholds.json');
// Primary retriever comparison for the power analysis: the API's two strategies with the default embedder.
const PRIMARY = ['hybrid:local', 'vector:local'];
const DELTA = 0.05;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
};
const M = (b) => ({ value: b.value, ci_low: b.ci[0], ci_high: b.ci[1], n: b.n });
const tokens = (s) => (s.toLowerCase().match(/[a-z0-9$%.]+/g) || []).map((t) => t.replace(/\.$/, '')).filter((t) => t.length > 2);

/** Share of answer sentences whose content tokens are >= 80% present in the cited passages (lexical support). */
export function faithfulness(answer, citedTexts) {
  const body = answer.replace(/\[\d+\]/g, ' ');
  const sents = body.split(/(?<=[.!?;:])\s+/).map((s) => s.trim()).filter((s) => tokens(s).length);
  if (!sents.length) return null;
  const support = new Set(citedTexts.flatMap(tokens));
  const ok = sents.filter((s) => {
    const t = tokens(s);
    return t.filter((x) => support.has(x)).length / t.length >= 0.8;
  });
  return ok.length / sents.length;
}

/** Error taxonomy (one label per question), using the app's refusal behaviour. */
export function taxonomy(r) {
  if (r.correct) return 'correct';
  if (!r.answerable) return 'generation_error'; // answered a question the corpus cannot answer
  if (r.rank === null) return 'retrieval_miss';
  if (r.refused) return 'wrong_refusal';
  return 'wrong_answer_despite_correct_retrieval';
}
const TAXA = ['correct', 'retrieval_miss', 'wrong_refusal', 'wrong_answer_despite_correct_retrieval', 'generation_error'];

/** Apply the app's coverage gate to raw eval rows + details. */
export function appRows(res, run) {
  const rows = res.rowsByRun[run];
  const det = res.detailsByRun[run];
  return rows.map((r, i) => {
    const d = det[i];
    const gated = r.coverage < MIN_COVERAGE;
    const refused = gated || r.refused;
    const correct = r.answerable ? !refused && r.correct : refused;
    const cited = refused ? [] : d.cited;
    const out = { ...r, refused, correct, answer: refused ? 'REFUSED' : d.answer, cited, retrieved: d.retrieved, latencyMs: d.latencyMs, usage: refused ? null : d.usage };
    out.error = taxonomy(out);
    return out;
  });
}

function runMetrics(rows) {
  const ans = rows.filter((r) => r.answerable);
  const un = rows.filter((r) => !r.answerable);
  const answered = ans.filter((r) => !r.refused);
  const m = {
    'hit@1': M(bootstrapMean(ans.map((r) => hitAt(r.rank, 1)), BOOT)),
    'hit@5': M(bootstrapMean(ans.map((r) => hitAt(r.rank, 5)), BOOT)),
    'mrr@5': M(bootstrapMean(ans.map((r) => (r.rank ? 1 / r.rank : 0)), BOOT)),
    answer_accuracy: M(bootstrapMean(ans.map((r) => +r.correct), BOOT)),
    citation_accuracy: M(bootstrapMean(answered.map((r) => +r.cited.some((c) => c.relevant)), BOOT)),
    citation_precision: M(bootstrapMean(answered.map((r) => (r.cited.length ? r.cited.filter((c) => c.relevant).length / r.cited.length : 0)), BOOT)),
    faithfulness: M(bootstrapMean(rows.filter((r) => !r.refused).map((r) => faithfulness(r.answer, r.cited.map((c) => c.text))).filter((x) => x !== null), BOOT)),
    latency_p50_ms: M(bootstrapQuantile(rows.map((r) => r.latencyMs), 0.5, BOOT)),
    latency_p95_ms: M(bootstrapQuantile(rows.map((r) => r.latencyMs), 0.95, BOOT)),
    cost_per_query_usd_extractive: { value: 0, ci_low: 0, ci_high: 0, n: rows.length },
  };
  for (const p of Object.keys(PRICES).filter((x) => x !== 'extractive')) {
    // per 1,000 queries before bootstrapping, so 4-decimal rounding keeps precision
    const costs = rows.map((r) => (r.usage ? estimateCostUsd(p, r.usage) * 1000 : 0));
    m[`est_cost_per_1k_queries_usd_${p}`] = M(bootstrapMean(costs, BOOT));
  }
  if (un.length) {
    m.refusal_accuracy = M(bootstrapMean(un.map((r) => +r.correct), BOOT));
    m.overall_accuracy = M(bootstrapMean(rows.map((r) => +r.correct), BOOT));
    const k = un.filter((r) => r.correct).length;
    m.refusal_accuracy.exact_ci = clopperPearson(k, un.length);
  }
  for (const key of ['hit@5', 'answer_accuracy', 'refusal_accuracy']) {
    const v = m[key];
    if (v && (v.value === 1 || v.value === 0)) {
      const k = Math.round(v.value * v.n);
      const [lo, hi] = clopperPearson(k, v.n);
      Object.assign(v, { ci_low: lo, ci_high: hi, ci_method: 'clopper-pearson (all-or-none outcome)' });
    }
  }
  const counts = Object.fromEntries(TAXA.map((t) => [t, rows.filter((r) => r.error === t).length]));
  return { metrics: m, taxonomy: counts };
}

function compare(rowsA, rowsB, metric) {
  const pick = (rows) => (metric === 'hit@5' ? rows.filter((r) => r.answerable).map((r) => hitAt(r.rank, 5)) : rows.map((r) => +r.correct));
  const a = pick(rowsA);
  const b = pick(rowsB);
  const d = pairedBootstrapDiff(a, b, BOOT);
  return { metric, n: a.length, diff: d.diff, ci_low: d.ci[0], ci_high: d.ci[1], mcnemar: mcnemarExact(a, b) };
}

const pct = (x) => (x === null || x === undefined ? 'n/a' : (x * 100).toFixed(1));
const fmt = (m) => (m ? `${pct(m.value)} [${pct(m.ci_low)}–${pct(m.ci_high)}]` : 'n/a');
const ms = (m) => `${m.value.toFixed(1)} [${m.ci_low.toFixed(1)}–${m.ci_high.toFixed(1)}]`;

async function main() {
  const args = process.argv.slice(2);
  const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
  const embedders = opt('--embedders', 'local,minilm').split(',').filter(Boolean);
  const name = opt('--name', 'eval');
  const started = new Date();
  const stamp = started.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const runId = `${stamp}-${name}`;
  const log = (s) => console.log(s);

  log('docIQ eval: test (hand-written), syn-test (SYNTHETIC), dev (power analysis only)');
  const sets = {
    test: { path: DS('public-docs-qa.json'), label: 'hand-written test split' },
    'syn-test': { path: DS('synthetic-test.json'), label: 'SYNTHETIC test split' },
    dev: { path: DS('dev-qa.json'), label: 'hand-written dev split' },
    'syn-dev': { path: DS('synthetic-dev.json'), label: 'SYNTHETIC dev split' },
  };
  const res = {};
  for (const [k, s] of Object.entries(sets)) {
    log(`- ${k}`);
    res[k] = await runEval({ embedders, datasetPath: s.path, log: () => {} });
  }

  // Legacy results file (byte-stable; `npm run eval:check` / test/eval.test.js compare against it).
  const legacy = { ...res.test, meta: { generatedBy: 'node eval/run.js', node: process.version } };
  delete legacy.rowsByRun;
  delete legacy.detailsByRun;
  await fs.writeFile(RESULTS_PATH, JSON.stringify(legacy, null, 2) + '\n');

  const runNames = Object.keys(res.test.rowsByRun);
  const app = {};
  for (const k of Object.keys(sets)) app[k] = Object.fromEntries(runNames.map((r) => [r, appRows(res[k], r)]));

  // ---- metrics (reported splits only)
  const metrics = {};
  const taxonomyOut = {};
  for (const split of ['test', 'syn-test']) {
    for (const r of runNames) {
      const { metrics: m, taxonomy: t } = runMetrics(app[split][r]);
      for (const [key, v] of Object.entries(m)) metrics[`${split}/${r}/${key}`] = v;
      taxonomyOut[`${split}/${r}`] = t;
    }
  }

  // ---- paired comparisons (bootstrap + exact McNemar)
  const pairs = [
    ['hybrid:local', 'vector:local'],
    ['hybrid:local', 'bm25'],
    ['hybrid-rrf:local', 'vector:local'],
    ['hybrid:minilm', 'vector:minilm'],
    ['hybrid:minilm', 'bm25'],
    ['vector:minilm', 'vector:local'],
  ].filter(([a, b]) => runNames.includes(a) && runNames.includes(b));
  const comparisons = [];
  for (const split of ['test', 'syn-test']) {
    for (const [a, b] of pairs) {
      for (const metric of split === 'test' ? ['hit@5', 'overall_accuracy'] : ['hit@5', 'answer_accuracy']) {
        comparisons.push({ split, a, b, ...compare(app[split][a], app[split][b], metric) });
      }
    }
  }

  // ---- power analysis: discordance estimated on the DEV splits only
  const disc = (split) => {
    const c = compare(app[split][PRIMARY[0]], app[split][PRIMARY[1]], 'hit@5').mcnemar;
    return { n: c.n, discordant: c.discordant, rate: c.n ? c.discordant / c.n : 0 };
  };
  const dd = [disc('dev'), disc('syn-dev')];
  const pDisc = (dd[0].discordant + dd[1].discordant) / (dd[0].n + dd[1].n);
  const required = mcnemarSampleSize({ delta: DELTA, pDisc });
  const nHand = app.test[PRIMARY[0]].filter((r) => r.answerable).length;
  const nSyn = app['syn-test'][PRIMARY[0]].length;
  const power = {
    comparison: `${PRIMARY[0]} vs ${PRIMARY[1]}, hit@5 (paired, exact McNemar), alpha=0.05 two-sided, power=0.80`,
    target_delta: DELTA,
    discordance_rate_dev: Number(pDisc.toFixed(4)),
    discordance_source: { 'dev-qa (answerable)': dd[0], 'synthetic-dev': dd[1] },
    required_n: required,
    achieved_n: { hand_written_test: nHand, synthetic_test: nSyn },
    reachable: { hand_written_test: nHand >= required, synthetic_test: nSyn >= required },
    detectable_delta_at_achieved_n: {
      hand_written_test: mcnemarDetectableDelta({ n: nHand, pDisc }),
      synthetic_test: mcnemarDetectableDelta({ n: nSyn, pDisc }),
    },
    method: 'Connor (1987) sample size for McNemar; discordance P(systems disagree) estimated on dev splits only',
  };

  // ---- regression gate
  const thresholds = JSON.parse(await fs.readFile(THRESHOLDS_PATH, 'utf8').catch(() => '{"floors":{}}'));
  const gate = Object.entries(thresholds.floors || {}).map(([key, floor]) => ({ key, floor, value: metrics[key]?.value ?? null, pass: (metrics[key]?.value ?? -1) >= floor }));

  // ---- write results/ layout
  const dir = path.join(RESULTS, 'runs', runId);
  await fs.mkdir(dir, { recursive: true });
  const datasetHash = sha((await Promise.all(Object.values(sets).map((s) => fs.readFile(s.path, 'utf8')))).join('\n'));
  const pkg = JSON.parse(await fs.readFile(path.join(BACKEND, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(BACKEND, 'package-lock.json'), 'utf8'));
  const ver = (p) => lock.packages?.[`node_modules/${p}`]?.version || null;
  const cfg = { ...res.test.config, minCoverage: MIN_COVERAGE, embedders, bootstrap: BOOT };
  const finished = new Date();
  const manifest = {
    run_id: runId,
    project: 'docIQ',
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    git_sha: sh('git rev-parse HEAD'),
    git_dirty: Boolean(sh('git status --porcelain --untracked-files=no')),
    config_hash: sha(JSON.stringify(cfg)),
    dataset_hash: datasetHash,
    datasets: Object.fromEntries(Object.entries(sets).map(([k, s]) => [k, { path: path.relative(ROOT, s.path).replace(/\\/g, '/'), label: s.label, questions: res[k].dataset.questions }])),
    seed: BOOT.seed,
    language: `node ${process.version}`,
    libraries: { [pkg.name]: pkg.version, '@huggingface/transformers': ver('@huggingface/transformers'), mongoose: ver('mongoose') },
    llm: res.test.config.llm,
    command: 'cd backend && npm run eval',
    config: cfg,
  };
  const items = [];
  for (const split of ['test', 'syn-test']) {
    for (const r of runNames) {
      for (const x of app[split][r]) {
        items.push({
          split, run: r, id: x.id, answerable: x.answerable, rank: x.rank, refused: x.refused, correct: x.correct, error: x.error,
          coverage: x.coverage, latency_ms: Number(x.latencyMs.toFixed(3)),
          retrieved: x.retrieved.map((c) => `${c.docId}#${c.idx}${c.relevant ? '*' : ''}`),
          cited: x.cited.map((c) => `${c.docId}#${c.idx}${c.relevant ? '*' : ''}`),
          answer: x.answer.length > 300 ? x.answer.slice(0, 300) + '…' : x.answer,
        });
      }
    }
  }
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await fs.writeFile(path.join(dir, 'metrics.json'), JSON.stringify({ metrics, taxonomy: taxonomyOut, comparisons, power, regression_gate: gate, not_produced: res.test.notProduced }, null, 2) + '\n');
  await fs.writeFile(path.join(dir, 'items.jsonl'), items.map((i) => JSON.stringify(i)).join('\n') + '\n');
  const report = renderReport({ manifest, metrics, taxonomyOut, comparisons, power, gate, runNames, notProduced: res.test.notProduced });
  await fs.writeFile(path.join(dir, 'report.md'), report);

  // index.sqlite + latest.json + TRENDS.md
  const db = new DatabaseSync(path.join(RESULTS, 'index.sqlite'));
  db.exec(`CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, project TEXT, started_at TEXT, finished_at TEXT, git_sha TEXT, git_dirty INTEGER, config_hash TEXT, dataset_hash TEXT, seed INTEGER, command TEXT);
           CREATE TABLE IF NOT EXISTS metrics (run_id TEXT, key TEXT, value REAL, ci_low REAL, ci_high REAL, n INTEGER, PRIMARY KEY (run_id, key));`);
  db.prepare('INSERT OR REPLACE INTO runs VALUES (?,?,?,?,?,?,?,?,?,?)').run(runId, 'docIQ', manifest.started_at, manifest.finished_at, manifest.git_sha, manifest.git_dirty ? 1 : 0, manifest.config_hash, datasetHash, BOOT.seed, manifest.command);
  const ins = db.prepare('INSERT OR REPLACE INTO metrics VALUES (?,?,?,?,?,?)');
  for (const [k, v] of Object.entries(metrics)) ins.run(runId, k, v.value, v.ci_low, v.ci_high, v.n);
  const trend = renderTrends(db);
  db.close();
  await fs.writeFile(path.join(RESULTS, 'TRENDS.md'), trend);
  await fs.writeFile(path.join(RESULTS, 'latest.json'), JSON.stringify({ run_id: runId, path: `results/runs/${runId}` }, null, 2) + '\n');

  if (!args.includes('--no-readme')) {
    const { updateReadme } = await import('./readme-block.js');
    await updateReadme();
  }
  log(report);
  log(`wrote results/runs/${runId}`);
  if (gate.some((g) => !g.pass)) {
    console.error('REGRESSION GATE FAILED');
    process.exit(1);
  }
}

export const HEADLINE = [
  ['hit@5', 'hit@5'],
  ['mrr@5', 'MRR@5 (×100)'],
  ['answer_accuracy', 'Answer acc.'],
  ['refusal_accuracy', 'Refusal acc.'],
  ['overall_accuracy', 'Overall acc.'],
  ['citation_accuracy', 'Citation acc.'],
  ['faithfulness', 'Faithfulness'],
];

function renderReport({ manifest, metrics, taxonomyOut, comparisons, power, gate, runNames, notProduced }) {
  const L = [];
  L.push(`# docIQ eval report — ${manifest.run_id}`, '');
  L.push(`git ${manifest.git_sha?.slice(0, 7)}${manifest.git_dirty ? ' (dirty)' : ''} · ${manifest.language} · llm=${manifest.llm} · seed ${manifest.seed} · \`${manifest.command}\``, '');
  L.push('Values in %, 95% bootstrap CI (10,000 resamples). Answer metrics include the app refusal gates (confidence 0.15, query coverage 0.30). Only test splits are reported; dev splits feed the power analysis.', '');
  for (const [split, title] of [['test', 'Hand-written test split (71 q: 58 answerable, 13 unanswerable)'], ['syn-test', 'SYNTHETIC test split (template-generated, answerable only)']]) {
    const cols = HEADLINE.filter(([k]) => metrics[`${split}/${runNames[0]}/${k}`]);
    L.push(`## ${title}`, '', `| Run | ${cols.map((c) => c[1]).join(' | ')} | p50 ms | p95 ms |`, `|---|${cols.map(() => '---').join('|')}|---|---|`);
    for (const r of runNames) {
      const g = (k) => metrics[`${split}/${r}/${k}`];
      L.push(`| ${r} | ${cols.map(([k]) => fmt(g(k))).join(' | ')} | ${ms(g('latency_p50_ms'))} | ${ms(g('latency_p95_ms'))} |`);
    }
    L.push('', `Error taxonomy (${split}):`, '', `| Run | ${TAXA.join(' | ')} |`, `|---|${TAXA.map(() => '---').join('|')}|`);
    for (const r of runNames) L.push(`| ${r} | ${TAXA.map((t) => taxonomyOut[`${split}/${r}`][t]).join(' | ')} |`);
    L.push('');
  }
  L.push('## Paired comparisons (a − b)', '', '| Split | a − b | Metric | n | Δ pts [95% CI] | McNemar b10/b01 | exact p |', '|---|---|---|---|---|---|---|');
  for (const c of comparisons) {
    L.push(`| ${c.split} | ${c.a} − ${c.b} | ${c.metric} | ${c.n} | ${(c.diff * 100).toFixed(1)} [${(c.ci_low * 100).toFixed(1)}, ${(c.ci_high * 100).toFixed(1)}] | ${c.mcnemar.b10}/${c.mcnemar.b01} | ${c.mcnemar.pValue} |`);
  }
  L.push('', '## Power analysis', '');
  L.push(`${power.comparison}. Target difference ${power.target_delta * 100} points. Discordance rate on dev splits: ${power.discordance_rate_dev}.`);
  L.push(`Required n = **${power.required_n}** paired answerable questions. Achieved: hand-written test **${power.achieved_n.hand_written_test}** (${power.reachable.hand_written_test ? 'reached' : 'NOT reached'}), synthetic test **${power.achieved_n.synthetic_test}** (${power.reachable.synthetic_test ? 'reached' : 'NOT reached'}).`);
  const dd = power.detectable_delta_at_achieved_n;
  L.push(`Detectable difference at achieved n (80% power): hand-written ${dd.hand_written_test === null ? `> ${(power.discordance_rate_dev * 100).toFixed(1)} pts (larger than the dev discordance rate)` : `${(dd.hand_written_test * 100).toFixed(1)} pts`}, synthetic ${dd.synthetic_test === null ? 'n/a' : `${(dd.synthetic_test * 100).toFixed(1)} pts`}.`, '');
  L.push('## Cost per query', '', 'Actual: $0 (extractive provider, no LLM call). Estimated cost per 1,000 queries if the same prompts went to an LLM (list prices in src/services/query/usage.js, tokens ≈ chars/4, completion length = extractive answer length):', '');
  L.push('| Split/run | ' + Object.keys(PRICES).filter((p) => p !== 'extractive').join(' | ') + ' |', '|---|' + Object.keys(PRICES).filter((p) => p !== 'extractive').map(() => '---').join('|') + '|');
  for (const r of ['vector:local', 'hybrid:local'].filter((x) => runNames.includes(x))) {
    L.push(`| test/${r} | ` + Object.keys(PRICES).filter((p) => p !== 'extractive').map((p) => { const m = metrics[`test/${r}/est_cost_per_1k_queries_usd_${p}`]; return `$${m.value.toFixed(3)} [${m.ci_low.toFixed(3)}–${m.ci_high.toFixed(3)}]`; }).join(' | ') + ' |');
  }
  L.push('', '## Regression gate (eval/thresholds.json)', '', '| Metric | Floor | Value | Pass |', '|---|---|---|---|');
  for (const g of gate) L.push(`| ${g.key} | ${g.floor} | ${g.value} | ${g.pass ? 'yes' : 'NO'} |`);
  L.push('', '## Definitions', '',
    '- hit@k / MRR@5: answerable questions; a chunk is relevant if it is from the gold document and contains a verbatim evidence span.',
    '- Citation accuracy: answered answerable questions where at least one cited chunk is relevant. Citation precision: relevant cited / cited.',
    '- Faithfulness: share of answer sentences with ≥80% of content tokens present in the cited chunks (lexical proxy, no LLM judge; near 1 by construction for the extractive provider).',
    '- Error taxonomy: retrieval_miss (no relevant chunk in top 5), wrong_refusal (relevant chunk retrieved but refused), wrong_answer_despite_correct_retrieval (relevant chunk retrieved, answered, gold string absent), generation_error (answered an unanswerable question).',
    '- Latency: in-process retrieve + answer time per question in the eval harness (no network, no MongoDB); API latency is in the load-test results.',
    '');
  if (notProduced?.length) L.push('## Not produced', '', ...notProduced.map((n) => `- ${n}`), '');
  return L.join('\n');
}

function renderTrends(db) {
  const keys = ['test/hybrid:local/hit@5', 'test/vector:local/hit@5', 'test/hybrid:local/refusal_accuracy', 'test/hybrid:local/overall_accuracy', 'syn-test/hybrid:local/hit@5', 'test/hybrid:local/latency_p95_ms'];
  const runs = db.prepare('SELECT run_id, git_sha, git_dirty FROM runs ORDER BY run_id').all();
  const get = db.prepare('SELECT value, ci_low, ci_high FROM metrics WHERE run_id = ? AND key = ?');
  const L = ['# Eval history (generated from results/index.sqlite by eval/run.js)', '', `| Run | git | ${keys.join(' | ')} |`, `|---|---|${keys.map(() => '---').join('|')}|`];
  for (const r of runs) {
    L.push(`| ${r.run_id} | ${(r.git_sha || '').slice(0, 7)}${r.git_dirty ? '*' : ''} | ${keys.map((k) => { const v = get.get(r.run_id, k); return v ? `${v.value} [${v.ci_low}, ${v.ci_high}]` : '—'; }).join(' | ')} |`);
  }
  L.push('', '`*` = run from a dirty working tree.', '');
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
