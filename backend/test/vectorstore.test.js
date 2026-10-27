import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryVectorStore, ChromaVectorStore } from '../src/services/retrieval/vectorStore.js';

const unit = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

test('memory store: tenant filter is applied before ranking; deleteByFilter scoped', async () => {
  const s = new MemoryVectorStore();
  await s.upsert([
    { id: 'a1', vector: unit([1, 0]), metadata: { workspaceId: 'A', documentId: 'd1' } },
    { id: 'b1', vector: unit([1, 0.01]), metadata: { workspaceId: 'B', documentId: 'd2' } },
    { id: 'a2', vector: unit([0, 1]), metadata: { workspaceId: 'A', documentId: 'd3' } },
  ]);
  const hits = await s.query(unit([1, 0]), { topK: 5, filter: { workspaceId: 'A' } });
  assert.deepEqual(hits.map((h) => h.id), ['a1', 'a2']);
  await s.deleteByFilter({ documentId: 'd1' });
  assert.deepEqual((await s.query(unit([1, 0]), { topK: 5 })).map((h) => h.id).sort(), ['a2', 'b1']);
});

test('chroma store: sends the tenant filter as `where`, maps distance to cosine, surfaces errors', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith('/collections')) return new Response(JSON.stringify({ id: 'col1' }), { status: 200 });
    if (url.endsWith('/query')) return new Response(JSON.stringify({ ids: [['x']], distances: [[0.5]], metadatas: [[{ workspaceId: 'A' }]] }), { status: 200 });
    if (url.endsWith('/upsert') && body.ids[0] === 'bad') return new Response('boom', { status: 500 });
    return new Response('{}', { status: 200 });
  };
  try {
    const s = new ChromaVectorStore({ url: 'http://chroma:8000/', collection: 'c' });
    await s.upsert([{ id: 'x', vector: [1, 0], metadata: { workspaceId: 'A', text: 't' } }]);
    const hits = await s.query([1, 0], { topK: 3, filter: { workspaceId: 'A' } });
    assert.deepEqual(hits, [{ id: 'x', score: 0.75, metadata: { workspaceId: 'A' } }]);
    const q = calls.find((c) => c.url.endsWith('/query'));
    assert.deepEqual(q.body.where, { workspaceId: 'A' });
    assert.equal(q.body.n_results, 3);
    await s.deleteByFilter({ documentId: 'd1' });
    assert.deepEqual(calls.at(-1).body, { where: { documentId: 'd1' } });
    await assert.rejects(s.upsert([{ id: 'bad', vector: [1], metadata: {} }]), /Chroma upsert 500/);
    assert.equal(calls.filter((c) => c.url.endsWith('/collections')).length, 1, 'collection id cached');
  } finally {
    globalThis.fetch = realFetch;
  }
});
