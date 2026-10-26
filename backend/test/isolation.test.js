import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

// Tenant isolation: workspace B (with its own valid key) must never see A's documents,
// chunks, answers, history or feedback, through any route or the retriever/caches.
let h;
let A;
let B;
let docA;
let chunkA;
let queryA;

const TEXT_A =
  'ALPHA SERVICES AGREEMENT. The Zephyrine retainer fee is 47,311 dollars per quarter. ' +
  'Either party may end the Zephyrine engagement with sixty days notice. Governing law is Ohio.';
const TEXT_B =
  'BETA SUPPLY CONTRACT. The widget unit price is 12 dollars. Deliveries occur every Monday. ' +
  'Governing law is Texas.';

before(async () => {
  h = await startApp();
  A = await h.workspace('tenant-a');
  B = await h.workspace('tenant-b');
  docA = await h.uploadReady(A, TEXT_A, 'a.txt');
  await h.uploadReady(B, TEXT_B, 'b.txt');
  const q = await h.query(A, 'What is the Zephyrine retainer fee?');
  assert.equal(q.status, 200);
  assert.match(q.body.answer, /47,311/);
  chunkA = q.body.citations[0].chunkId;
  queryA = q.body.queryId;
});
after(() => h.stop());

const asB = (req) => req.set('x-workspace-key', B.key);

test('B cannot read A document status, risks, download, chunks or chunk-by-id (404, no existence leak)', async () => {
  for (const url of [
    `/api/documents/${docA}/status`,
    `/api/documents/${docA}/risks`,
    `/api/documents/${docA}/download`,
    `/api/documents/${docA}/chunks/0`,
    `/api/documents/chunk/${chunkA}`,
  ]) {
    const r = await asB(h.api.get(url));
    assert.equal(r.status, 404, url);
    assert.doesNotMatch(JSON.stringify(r.body), /Zephyrine|47,311/, url);
  }
});

test('B cannot delete A documents; A document survives', async () => {
  const r = await asB(h.api.delete(`/api/documents/${docA}`));
  assert.equal(r.status, 404);
  const s = await h.api.get(`/api/documents/${docA}/status`).set('x-workspace-key', A.key);
  assert.equal(s.body.status, 'ready');
});

test('B key cannot list, read, configure, query or read history of workspace A', async () => {
  assert.equal((await asB(h.api.get(`/api/documents?workspaceId=${A.id}`))).status, 404);
  assert.equal((await asB(h.api.get(`/api/workspaces/${A.id}`))).status, 404);
  assert.equal((await asB(h.api.get(`/api/workspaces/${A.id}/history`))).status, 404);
  assert.equal((await asB(h.api.patch(`/api/workspaces/${A.id}/settings`).send({ topK: 3 }))).status, 404);
  assert.equal((await h.query(A, 'What is the Zephyrine retainer fee?', B.key)).status, 404);
  assert.equal((await h.api.post(`/api/query/${queryA}/feedback`).set('x-workspace-key', B.key).send({ rating: 'down' })).status, 404);
});

test('no key → 401; unknown workspace id with any key → 404', async () => {
  assert.equal((await h.api.get(`/api/documents/${docA}/status`)).status, 401);
  assert.equal((await h.api.post('/api/query').send({ workspaceId: A.id, question: 'fee?' })).status, 401);
  const r = await h.api.get('/api/workspaces/0123456789abcdef01234567').set('x-workspace-key', A.key);
  assert.equal(r.status, 404);
});

test('listing workspaces does not enumerate tenants', async () => {
  const r = await h.api.get('/api/workspaces');
  assert.equal(r.status, 200);
  assert.ok(!r.body.some((w) => [A.id, B.id].includes(String(w._id))));
  assert.ok(!JSON.stringify(r.body).includes('accessKeyHash'));
});

test('B retrieval never returns A chunks, even for A-specific questions', async () => {
  for (const q of ['What is the Zephyrine retainer fee?', 'Zephyrine engagement notice', 'governing law', 'fee per quarter 47,311']) {
    const r = await h.query(B, q);
    assert.equal(r.status, 200);
    const ids = [...r.body.retrieved.map((x) => x.documentId), ...r.body.citations.map((c) => c.documentId)];
    assert.ok(!ids.includes(docA), `leak for "${q}"`);
    assert.doesNotMatch(r.body.answer, /Zephyrine|47,311|Ohio/);
  }
});

test('answer cache is tenant-scoped: same question in B is not served A cached answer', async () => {
  const q = 'What is the governing law?';
  const a1 = await h.query(A, q);
  const a2 = await h.query(A, q);
  assert.equal(a2.body.cached, true);
  const b1 = await h.query(B, q);
  assert.equal(b1.body.cached, false);
  assert.match(a1.body.answer, /Ohio/);
  assert.doesNotMatch(b1.body.answer, /Ohio/);
});

test('retriever is scoped at the data layer too (direct call)', async () => {
  const { retrieve } = await import('../src/services/retrieval/retriever.js');
  const chunks = await retrieve('Zephyrine retainer fee quarter', { workspaceId: B.id, topK: 25 });
  assert.ok(chunks.every((c) => String(c.workspaceId) === B.id));
});

test('A history contains only A queries', async () => {
  const r = await h.api.get(`/api/workspaces/${A.id}/history`).set('x-workspace-key', A.key);
  assert.equal(r.status, 200);
  assert.ok(r.body.length >= 1);
  assert.ok(r.body.every((x) => String(x.workspaceId) === A.id));
});
