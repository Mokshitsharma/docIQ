/**
 * Shared test harness: in-memory MongoDB + the real Express app (supertest).
 * Env must be set before any src/ module is imported, so callers pass overrides here
 * and import app modules only through the returned object.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_MSA = path.resolve(__dirname, '../eval/fixtures/sample-msa.txt');

export async function startApp(env = {}) {
  const mongod = await MongoMemoryServer.create();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    MONGO_URI: mongod.getUri('dociq-test'),
    USE_QUEUE: 'false',
    VECTOR_STORE: 'memory',
    LLM_PROVIDER: 'extractive',
    EMBEDDING_PROVIDER: 'local',
    RATE_LIMIT_GLOBAL: '100000',
    RATE_LIMIT_QUERY: '100000',
    RATE_LIMIT_UPLOAD: '100000',
    ...env,
  });
  const { default: request } = await import('supertest');
  const { connectDB } = await import('../src/config/db.js');
  const { createApp } = await import('../src/index.js');
  const mongoose = (await import('mongoose')).default;
  await connectDB();
  const app = createApp();
  const api = request(app);

  const h = {
    app,
    api,
    async workspace(name = 'ws') {
      const r = await api.post('/api/workspaces').send({ name });
      if (r.status !== 201) throw new Error(`create workspace: ${r.status} ${JSON.stringify(r.body)}`);
      return { id: r.body._id, key: r.body.accessKey, body: r.body };
    },
    async upload(ws, content, filename = 'doc.txt') {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      return api
        .post('/api/documents/upload')
        .set('x-workspace-key', ws.key)
        .field('workspaceId', ws.id)
        .attach('file', buf, filename);
    },
    async uploadReady(ws, content, filename) {
      const r = await h.upload(ws, content, filename);
      if (r.status !== 202) throw new Error(`upload: ${r.status} ${JSON.stringify(r.body)}`);
      const id = r.body.document._id;
      for (let i = 0; i < 200; i++) {
        const s = await api.get(`/api/documents/${id}/status`).set('x-workspace-key', ws.key);
        if (s.body.status === 'ready') return id;
        if (s.body.status === 'failed') throw new Error(`ingest failed: ${s.body.error}`);
        await new Promise((res) => setTimeout(res, 25));
      }
      throw new Error('ingest timeout');
    },
    query(ws, question, key = ws.key) {
      return api.post('/api/query').set('x-workspace-key', key).send({ workspaceId: ws.id, question });
    },
    async stop() {
      await mongoose.disconnect();
      await mongod.stop();
    },
  };
  return h;
}

export const msaText = () => fs.readFileSync(FIXTURE_MSA, 'utf8');
