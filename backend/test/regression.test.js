/**
 * Retrieval-regression gate: hit@5 and refusal accuracy (with the app's refusal
 * gates) must not fall below the floors recorded in eval/thresholds.json.
 * Runs the local-embedder eval only (no model download), fully offline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEval } from '../eval/eval.js';
import { appRows } from '../eval/run.js';
import { hitAt } from '../eval/lib/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { floors } = JSON.parse(await fs.readFile(path.join(__dirname, '../eval/thresholds.json'), 'utf8'));
const DATA = { test: 'public-docs-qa.json', 'syn-test': 'synthetic-test.json' };

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r4 = (x) => Number(x.toFixed(4));

for (const split of Object.keys(DATA)) {
  test(`regression gate: ${split} split meets eval/thresholds.json floors`, async () => {
    const keys = Object.keys(floors).filter((k) => k.startsWith(`${split}/`));
    assert.ok(keys.length > 0);
    const res = await runEval({ embedders: ['local'], datasetPath: path.join(__dirname, '../eval/datasets', DATA[split]) });
    for (const key of keys) {
      const [, run, metric] = key.split('/');
      const rows = appRows(res, run);
      const value =
        metric === 'hit@5'
          ? mean(rows.filter((r) => r.answerable).map((r) => hitAt(r.rank, 5)))
          : mean(rows.filter((r) => !r.answerable).map((r) => +r.correct));
      assert.ok(r4(value) >= floors[key], `${key}: ${r4(value)} < floor ${floors[key]}`);
    }
  });
}
