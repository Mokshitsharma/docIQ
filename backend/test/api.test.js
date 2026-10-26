import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { startApp, msaText } from './helpers.js';

// API contract + upload hardening + middleware, via supertest against the real app.
let h;
let ws;
before(async () => {
  h = await startApp({ UPLOAD_MAX_BYTES: String(200 * 1024), QUOTA_MAX_DOCS: '5' });
  ws = await h.workspace('api');
});
after(() => h?.stop());

const docx = async (files) => {
  const z = new JSZip();
  for (const [name, data] of Object.entries(files)) z.file(name, data);
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};

test('security headers present, x-powered-by absent, request id echoed', async () => {
  const r = await h.api.get('/livez').set('x-request-id', 'abc-123');
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-powered-by'], undefined);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.ok(r.headers['content-security-policy']);
  assert.ok(r.headers['strict-transport-security']);
  assert.equal(r.headers['x-request-id'], 'abc-123');
});

test('readiness and metrics endpoints', async () => {
  const r = await h.api.get('/readyz');
  assert.equal(r.status, 200);
  assert.equal(r.body.mongo, true);
  const m = await h.api.get('/metrics');
  assert.equal(m.status, 200);
  assert.match(m.text, /http_request/);
});

test('upload: extension/content mismatch, unsupported type, empty, binary → 4xx', async () => {
  assert.equal((await h.upload(ws, Buffer.from('%PDF-1.4 fake'), 'x.txt')).status, 415);
  assert.equal((await h.upload(ws, 'plain text', 'x.pdf')).status, 415);
  assert.equal((await h.upload(ws, 'MZ', 'x.exe')).status, 415);
  assert.equal((await h.upload(ws, Buffer.from([0, 1, 2, 3, 0xff]), 'x.txt')).status, 415);
  assert.equal((await h.upload(ws, 'hello', 'x.docx')).status, 415);
});

test('upload: over size limit → 413', async () => {
  const r = await h.upload(ws, 'a '.repeat(150 * 1024), 'big.txt');
  assert.equal(r.status, 413);
});

test('upload: docx zip bomb (high compression ratio) → 413; zip that is not a docx → 400', async () => {
  const bomb = await docx({ '[Content_Types].xml': '<x/>', 'word/document.xml': '0'.repeat(20 * 1024 * 1024) });
  assert.ok(bomb.length < 200 * 1024);
  const r = await h.upload(ws, bomb, 'bomb.docx');
  assert.equal(r.status, 413);
  assert.match(r.body.error, /ratio|expands/);
  const notDocx = await docx({ 'a.txt': 'hi' });
  assert.equal((await h.upload(ws, notDocx, 'n.docx')).status, 400);
});

test('upload: filename is sanitised (no path traversal / control chars)', async () => {
  const r = await h.upload(ws, 'Some text about fees.', '../../etc/pass‮wd.txt');
  assert.equal(r.status, 202);
  assert.doesNotMatch(r.body.document.filename, /[\\/‮]|\.\./);
  // A NUL byte in the multipart header is malformed → 400, not 500.
  assert.equal((await h.upload(ws, 'x', 'a\u0000b.txt')).status, 400);
});

test('upload without file → 400; without key → 401', async () => {
  const r = await h.api.post('/api/documents/upload').set('x-workspace-key', ws.key).field('workspaceId', ws.id);
  assert.equal(r.status, 400);
  const r2 = await h.api.post('/api/documents/upload').field('workspaceId', ws.id).attach('file', Buffer.from('x'), 'a.txt');
  assert.equal(r2.status, 401);
});

test('query validation: missing / too long / non-string question → 400', async () => {
  assert.equal((await h.api.post('/api/query').set('x-workspace-key', ws.key).send({ workspaceId: ws.id })).status, 400);
  assert.equal((await h.query(ws, 'x'.repeat(2001))).status, 400);
  assert.equal((await h.api.post('/api/query').set('x-workspace-key', ws.key).send({ workspaceId: ws.id, question: { $gt: '' } })).status, 400);
});

test('NoSQL operator injection in workspaceId does not match other tenants', async () => {
  const r = await h.api.post('/api/query').set('x-workspace-key', ws.key).send({ workspaceId: { $ne: null }, question: 'fee?' });
  assert.ok([400, 404].includes(r.status), String(r.status));
});

test('ingest, query, cache hit, feedback, SSE stream', async () => {
  await h.uploadReady(ws, msaText(), 'msa.txt');
  const q = 'What is the governing law?';
  const a = await h.query(ws, q);
  assert.equal(a.status, 200);
  assert.ok(a.body.citations.length >= 1);
  assert.equal((await h.query(ws, q)).body.cached, true);

  const fb = await h.api.post(`/api/query/${a.body.queryId}/feedback`).set('x-workspace-key', ws.key).send({ rating: 'up' });
  assert.equal(fb.status, 204);
  const bad = await h.api.post(`/api/query/${a.body.queryId}/feedback`).set('x-workspace-key', ws.key).send({ rating: 'meh' });
  assert.equal(bad.status, 400);

  const s = await h.api.post('/api/query/stream').set('x-workspace-key', ws.key).send({ workspaceId: ws.id, question: 'What is the payment term?' });
  assert.equal(s.status, 200);
  assert.match(s.headers['content-type'], /text\/event-stream/);
  assert.match(s.text, /event: retrieved/);
  assert.match(s.text, /event: token/);
  assert.match(s.text, /event: done/);
});

test('document quota → 429 with Retry-After', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await h.upload(ws, `Quota doc ${i}.`, `q${i}.txt`);
  assert.equal(last.status, 429);
  assert.ok(last.headers['retry-after']);
});

test('unknown route → 404 JSON; malformed JSON → 400', async () => {
  assert.equal((await h.api.get('/api/nope')).status, 404);
  const r = await h.api.post('/api/workspaces').set('content-type', 'application/json').send('{bad');
  assert.equal(r.status, 400);
});

test('sanitizeFilename unit: traversal, reserved names, bidi, length', async () => {
  const { sanitizeFilename } = await import('../src/services/ingestion/fileGuard.js');
  assert.equal(sanitizeFilename(String.raw`..\..\windows\system32\evil.txt`), 'evil.txt');
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('CON.txt'), '_CON.txt');
  assert.doesNotMatch(sanitizeFilename('inv‮oice.txt'), /‮/);
  assert.ok(sanitizeFilename('a'.repeat(500) + '.pdf').length <= 120);
  assert.equal(sanitizeFilename(''), 'upload');
});
