import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, FIXTURE_MSA } from './helpers.js';
import fs from 'node:fs';

test('rehydrate: an emptied in-memory store is rebuilt from Mongo, including chunks saved without embeddings', async () => {
  const h = await startApp();
  try {
    const ws = await h.workspace('rehydrate-ws');
    await h.uploadReady(ws, fs.readFileSync(FIXTURE_MSA), 'msa.txt');

    const Chunk = (await import('../src/models/Chunk.js')).default;
    const { getVectorStore } = await import('../src/services/retrieval/vectorStore.js');
    const { rehydrateVectorStore } = await import('../src/services/retrieval/rehydrate.js');
    const total = await Chunk.countDocuments({ workspaceId: ws.id });
    // Simulate a restart, plus one legacy chunk ingested before embeddings were stored.
    await Chunk.updateOne({ workspaceId: ws.id }, { $unset: { embedding: 1 } });
    getVectorStore().items.clear();

    const { loaded, reembedded } = await rehydrateVectorStore();
    assert.equal(loaded, total);
    assert.equal(reembedded, 1);
    assert.equal(getVectorStore().items.size, total);

    // A question not asked before, so the answer cache cannot mask an empty index.
    const after = await h.query(ws, 'What is the termination notice period?');
    assert.equal(after.status, 200);
    assert.ok(after.body.citations?.length > 0);
  } finally {
    await h.stop();
  }
});
