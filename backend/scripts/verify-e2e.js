/**
 * One-shot end-to-end verification against an in-memory MongoDB.
 *
 *   npm run verify:e2e
 *
 * Spins up mongodb-memory-server, boots the real Express app, and drives the
 * full product flow over HTTP:
 *   health → create workspace → upload doc → poll ingestion → risks →
 *   query (grounded) → query (should refuse) → hybrid settings → re-query → history
 *
 * Providers default to extractive + local so no API keys are needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../eval/fixtures/sample-msa.txt');

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  →  ' + extra : ''}`);
  cond ? pass++ : fail++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('Starting in-memory MongoDB…');
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri('dociq');
  process.env.USE_QUEUE = 'false';
  process.env.VECTOR_STORE = 'memory';
  process.env.LLM_PROVIDER = 'extractive';
  process.env.EMBEDDING_PROVIDER = 'local';
  process.env.PORT = '4599';
  console.log('  uri:', process.env.MONGO_URI);

  const { connectDB } = await import('../src/config/db.js');
  const { default: createApp } = await import('../src/index.js');
  await connectDB();
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(4599, () => resolve(s));
  });
  const BASE = 'http://127.0.0.1:4599';
  console.log('  api:', BASE, '\n');

  try {
    // 1. health
    let r = await fetch(`${BASE}/health`);
    let body = await r.json();
    ok(r.status === 200 && body.ok, 'GET /health', JSON.stringify(body));

    // 2. create workspace
    r = await fetch(`${BASE}/api/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'E2E Legal' }),
    });
    const ws = await r.json();
    ok(r.status === 201 && ws._id, 'POST /api/workspaces', ws._id);
    ok(ws.settings && ws.settings.chunkSize > 0, 'workspace has default settings', JSON.stringify(ws.settings));

    // 2b. tune chunking for a small document via the dynamic-config API
    //     (the 800-token default is coarse for a ~4KB fixture — this is exactly
    //      the admin-panel knob the spec calls for)
    r = await fetch(`${BASE}/api/workspaces/${ws._id}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chunkSize: 300, chunkOverlap: 60 }),
    });
    const tuned = await r.json();
    ok(r.status === 200 && tuned.settings.chunkSize === 300, 'PATCH settings before ingest (chunkSize=300)');

    // 3. upload document (multipart)
    const fileBuf = fs.readFileSync(FIXTURE);
    const fd = new FormData();
    fd.append('workspaceId', ws._id);
    fd.append('file', new Blob([fileBuf], { type: 'text/plain' }), 'sample-msa.txt');
    r = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', body: fd });
    const up = await r.json();
    ok(r.status === 202 && up.document?._id, 'POST /api/documents/upload', `ingestion=${up.ingestion}`);
    const docId = up.document._id;

    // 4. poll ingestion status
    let status = 'processing';
    let statusBody;
    for (let i = 0; i < 40 && status === 'processing'; i++) {
      await sleep(250);
      statusBody = await (await fetch(`${BASE}/api/documents/${docId}/status`)).json();
      status = statusBody.status;
    }
    ok(
      status === 'ready',
      'document reached status "ready"',
      `pages=${statusBody.pageCount} chunks=${statusBody.chunkCount} err=${statusBody.error || '-'}`
    );

    // 5. risks
    r = await fetch(`${BASE}/api/documents/${docId}/risks`);
    const risks = await r.json();
    const riskItems = risks.risks?.items || [];
    ok(r.status === 200 && riskItems.length === 5, 'GET /api/documents/:id/risks', `${riskItems.length} clause cards`);
    ok(
      riskItems.some((i) => i.key === 'termination' && i.present),
      'termination clause detected in risk summary',
      riskItems.find((i) => i.key === 'termination')?.summary?.slice(0, 80)
    );

    // 6. grounded query
    r = await fetch(`${BASE}/api/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: ws._id, question: 'What is the monthly fee and when are invoices due?' }),
    });
    const ans = await r.json();
    ok(r.status === 200 && ans.grounded === true, 'POST /api/query is grounded', `conf=${ans.confidence}`);
    ok(
      /8,?000/.test(ans.answer) || ans.citations.some((c) => /8,?000/.test(c.excerpt)),
      'answer/citation contains the fee "8,000"',
      ans.answer.slice(0, 100)
    );
    ok(ans.citations.length > 0 && ans.citations[0].pageNumber >= 1, 'query returns citations with page numbers',
      `${ans.citations.length} citations, p.${ans.citations[0]?.pageNumber}`);

    // 7. out-of-scope query should refuse
    r = await fetch(`${BASE}/api/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: ws._id, question: 'What is the employee stock option vesting schedule at SpaceX?' }),
    });
    const refuse = await r.json();
    ok(
      refuse.grounded === false && /couldn'?t find/i.test(refuse.answer),
      'out-of-scope query is refused (no hallucination)',
      `conf=${refuse.confidence} "${refuse.answer.slice(0, 60)}"`
    );

    // 8. dynamic settings update
    r = await fetch(`${BASE}/api/workspaces/${ws._id}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topK: 8, retrievalStrategy: 'hybrid', confidenceThreshold: 0.05, bogusKey: 1 }),
    });
    const patched = await r.json();
    ok(
      r.status === 200 && patched.settings.retrievalStrategy === 'hybrid' && patched.settings.topK === 8,
      'PATCH /api/workspaces/:id/settings applies valid keys',
      `applied=${Object.keys(patched.applied).join(',')} rejected=${Object.keys(patched.rejected).join(',')}`
    );
    ok(patched.rejected.bogusKey, 'unknown setting key is rejected, not stored');

    // 9. re-query under hybrid strategy
    r = await fetch(`${BASE}/api/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: ws._id, question: 'How many days notice to terminate for convenience?' }),
    });
    const hy = await r.json();
    ok(
      hy.grounded === true && (/90|ninety/i.test(hy.answer) || hy.citations.some((c) => /90|ninety/i.test(c.excerpt))),
      'hybrid re-query answers termination-notice question',
      hy.answer.slice(0, 90)
    );

    // 10. history
    r = await fetch(`${BASE}/api/workspaces/${ws._id}/history`);
    const hist = await r.json();
    ok(
      r.status === 200 && hist.length === 3 && hist[0].latencyMs >= 0,
      'GET /api/workspaces/:id/history logged all 3 queries',
      `${hist.length} entries`
    );
  } finally {
    server.close();
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
    await mongod.stop();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('\nverify-e2e crashed:', err);
  process.exit(1);
});
