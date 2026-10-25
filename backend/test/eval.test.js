import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { loadDataset, buildChunks, isRelevant, runEval, normalize, RESULTS_PATH } from '../eval/eval.js';
import { bootstrapMean, pairedBootstrapDiff, firstRelevantRank, hitAt } from '../eval/lib/metrics.js';

test('dataset: 50+ questions, 10+ unanswerable, 5+ documents with source URL and license', async () => {
  const { spec, sources } = await loadDataset();
  const ids = spec.cases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'ids unique');
  assert.ok(spec.cases.length >= 50);
  assert.ok(spec.cases.filter((c) => !c.docId).length >= 10);
  assert.ok(sources.length >= 5);
  for (const s of sources) {
    assert.match(s.url, /^https:\/\//);
    assert.ok(s.license);
  }
  const docIds = new Set(sources.map((s) => s.id));
  for (const c of spec.cases.filter((x) => x.docId)) {
    assert.ok(docIds.has(c.docId), `${c.id}: unknown doc`);
    assert.ok(c.evidence?.length && c.answers?.length, `${c.id}: needs evidence and answers`);
  }
});

test('dataset: every evidence span is verbatim in its document and inside one chunk', async () => {
  const { spec, sources } = await loadDataset();
  const chunks = await buildChunks(sources);
  for (const c of spec.cases.filter((x) => x.docId)) {
    assert.ok(chunks.some((ch) => isRelevant(ch, c)), `${c.id}: evidence not found in any chunk of ${c.docId}`);
    for (const a of c.answers) {
      const docText = normalize(chunks.filter((ch) => ch.docId === c.docId).map((ch) => ch.text).join(' '));
      assert.ok(docText.includes(normalize(a)), `${c.id}: gold answer "${a}" not in document`);
    }
  }
});

test('metrics: bootstrap is deterministic and brackets the mean', () => {
  const xs = [1, 0, 1, 1, 0, 1, 1, 1, 0, 1];
  const a = bootstrapMean(xs, { resamples: 2000, seed: 7 });
  const b = bootstrapMean(xs, { resamples: 2000, seed: 7 });
  assert.deepEqual(a, b);
  assert.equal(a.value, 0.7);
  assert.ok(a.ci[0] <= 0.7 && 0.7 <= a.ci[1]);
  assert.deepEqual(bootstrapMean([1, 1, 1]).ci, [1, 1]);
  assert.deepEqual(pairedBootstrapDiff([1, 1], [1, 1]).ci, [0, 0]);
  assert.equal(firstRelevantRank([false, true, true]), 2);
  assert.equal(hitAt(2, 1), 0);
  assert.equal(hitAt(2, 3), 1);
});

test('eval reproduces the committed results (bm25 + local-embedder runs)', async () => {
  const committed = JSON.parse(await fs.readFile(RESULTS_PATH, 'utf8'));
  const fresh = await runEval({ embedders: ['local'] });
  assert.deepEqual(fresh.dataset, committed.dataset);
  assert.deepEqual(fresh.unreachableEvidence, committed.unreachableEvidence);
  for (const run of fresh.runs) {
    const old = committed.runs.find((r) => r.name === run.name);
    assert.ok(old, `run ${run.name} missing from committed results`);
    assert.deepEqual(run, old, `run ${run.name} differs from committed results`);
  }
});
