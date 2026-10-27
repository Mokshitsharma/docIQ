/**
 * Run the test suite with Node's built-in coverage, enforce coverage floors and
 * save a summary to results/tests/latest.json (read by the README results block).
 *
 *   npm run test:coverage
 *
 * Floors: >= 80% line coverage overall; >= 90% on the critical modules named in
 * the brief (ingestion, retrieval, tenant scoping).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const OUT = path.resolve(BACKEND, '..', 'results', 'tests');

export const OVERALL_MIN = 80;
export const CRITICAL_MIN = 90;
export const CRITICAL = [
  'services/ingestion/chunker.js',
  'services/ingestion/fileGuard.js',
  'services/ingestion/index.js',
  'services/ingestion/parser.js',
  'services/retrieval/retriever.js',
  'services/retrieval/bm25.js',
  'services/retrieval/vectorStore.js',
  'middleware/workspaceAuth.js',
];

const args = ['--test', '--experimental-test-coverage', '--test-coverage-include=src/**/*.js', 'test/**/*.test.js'];
const r = spawnSync(process.execPath, args, { cwd: BACKEND, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
process.stdout.write(out.split('\n').filter((l) => /^ℹ|^✖|# (tests|pass|fail)/.test(l)).join('\n') + '\n');

const num = (label) => Number(out.match(new RegExp(`^ℹ ${label} (\\d+)`, 'm'))?.[1] ?? NaN);
const tests = num('tests');
const pass = num('pass');
const fail = num('fail');

// Parse the coverage table: rows are "ℹ <indent>name | line% | branch% | funcs% | uncovered".
const rows = [];
const stack = [];
for (const line of out.split('\n')) {
  const m = line.match(/^ℹ (\s*)([^|]+?)\s*\|\s*([\d.]+)?\s*\|\s*([\d.]+)?\s*\|\s*([\d.]+)?\s*\|/);
  if (!m) continue;
  const depth = m[1].length;
  const name = m[2].trim();
  if (name === 'file') continue;
  stack.length = depth;
  if (m[3] === undefined) {
    stack[depth] = name; // directory row
    continue;
  }
  const file = [...stack.slice(0, depth).filter(Boolean), name].join('/');
  rows.push({ file, lines: Number(m[3]), branches: Number(m[4]), funcs: Number(m[5]) });
}
const all = rows.find((x) => x.file === 'all files');
const critical = CRITICAL.map((f) => {
  const row = rows.find((x) => x.file.endsWith(f));
  return { file: f, lines: row ? row.lines : null, branches: row ? row.branches : null };
});

const failures = [];
if (r.status !== 0 || fail > 0) failures.push(`test run failed (${fail} failing)`);
if (!all || all.lines < OVERALL_MIN) failures.push(`overall line coverage ${all?.lines} < ${OVERALL_MIN}`);
for (const c of critical) if (c.lines === null || c.lines < CRITICAL_MIN) failures.push(`${c.file} line coverage ${c.lines} < ${CRITICAL_MIN}`);

const summary = {
  generated_at: new Date().toISOString(),
  command: 'cd backend && npm run test:coverage',
  node: process.version,
  tests,
  pass,
  fail,
  coverage: { all: all || null, floors: { overall_lines: OVERALL_MIN, critical_lines: CRITICAL_MIN } },
  critical,
  gate_passed: failures.length === 0,
  failures,
};
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'latest.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`\ntests ${pass}/${tests} pass; lines ${all?.lines}% overall; critical: ${critical.map((c) => `${c.file}=${c.lines}%`).join(', ')}`);
if (failures.length) {
  console.error('COVERAGE GATE FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('coverage gate passed');
