/**
 * Load tests for the query and ingestion paths (autocannon; no Docker, no external services).
 *
 *   npm run load:query      node loadtest/run.js query  [--duration 15] [--steps 1,5,10,25,50]
 *   npm run load:ingest     node loadtest/run.js ingest [--duration 15] [--steps 1,5,10,25]
 *   node loadtest/run.js query --name after-fix   (label a run, e.g. before/after a change)
 *
 * Starts an in-memory MongoDB and ONE API process (node src/index.js; memory vector store,
 * local embeddings, extractive answers, inline ingestion), seeds a workspace with the
 * public eval corpus, then steps up concurrency. Every step reports throughput,
 * p50/p95/p99 latency and error/non-2xx counts. "Capacity" = highest step whose
 * p95 stays within the SLO (docs/architecture.md) with < 1% errors.
 *
 * Writes results/runs/<YYYYMMDD-HHMMSS>-load-<path>[-name]/{manifest.json, metrics.json, report.md}.
 * Numbers are for this machine (see manifest.host), single instance, in-process stores.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';
import { MongoMemoryServer } from 'mongodb-memory-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const ROOT = path.resolve(BACKEND, '..');
export const SLO = { query: { p95Ms: 800 }, ingest: { p95Ms: 1000 }, maxErrorRate: 0.01 };

const args = process.argv.slice(2);
const kind = args[0];
if (!['query', 'ingest'].includes(kind)) {
  console.error('usage: node loadtest/run.js query|ingest [--duration s] [--steps 1,5,10] [--name label] [--cache on|off]');
  process.exit(2);
}
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const duration = Number(opt('--duration', 15));
const steps = opt('--steps', kind === 'query' ? '1,5,10,25,50' : '1,5,10,25').split(',').map(Number);
const label = opt('--name', '');
const cacheMode = opt('--cache', 'off'); // off = every query unique (cold path); on = repeated questions
const PORT = 4600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;

const corpus = JSON.parse(await fs.readFile(path.join(BACKEND, 'eval/corpus/SOURCES.json'), 'utf8'));
const questions = JSON.parse(await fs.readFile(path.join(BACKEND, 'eval/datasets/public-docs-qa.json'), 'utf8')).cases.map((c) => c.question);

const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
const env = {
  ...process.env,
  NODE_ENV: 'production',
  LOG_LEVEL: 'warn',
  LOG_FORMAT: 'json',
  PORT: String(PORT),
  MONGO_URI: mongod.getUri('dociq-load'),
  USE_QUEUE: 'false',
  VECTOR_STORE: 'memory',
  LLM_PROVIDER: 'extractive',
  EMBEDDING_PROVIDER: 'local',
  CORS_ORIGIN: 'http://localhost:3000',
  RATE_LIMIT_GLOBAL: '10000000',
  RATE_LIMIT_QUERY: '10000000',
  RATE_LIMIT_UPLOAD: '10000000',
  QUOTA_MAX_DOCS: '100000',
  QUOTA_MAX_QUERIES_PER_DAY: '100000000',
  QUEUE_MAX_DEPTH: opt('--queue-depth', '100'),
};
const server = spawn(process.execPath, ['src/index.js'], { cwd: BACKEND, env, stdio: ['ignore', 'inherit', 'inherit'] });
const stop = async () => {
  server.kill('SIGTERM');
  await mongod.stop().catch(() => {});
};

async function waitReady() {
  for (let i = 0; i < 200; i++) {
    try {
      const r = await fetch(`${BASE}/readyz`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('API did not become ready');
}

async function api(method, p, { key, json, form } = {}) {
  const headers = { ...(key ? { 'x-workspace-key': key } : {}) };
  let body;
  if (json) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) body = form;
  const r = await fetch(`${BASE}${p}`, { method, headers, body });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function seedWorkspace() {
  const ws = (await api('POST', '/api/workspaces', { json: { name: 'load' } })).body;
  for (const s of corpus) {
    const fd = new FormData();
    fd.append('workspaceId', ws._id);
    fd.append('file', new Blob([await fs.readFile(path.join(BACKEND, 'eval/corpus', s.file))]), s.file);
    const up = await api('POST', '/api/documents/upload', { key: ws.accessKey, form: fd });
    if (up.status !== 202) throw new Error(`seed upload ${up.status}`);
    for (let i = 0; i < 400; i++) {
      const st = await api('GET', `/api/documents/${up.body.document._id}/status`, { key: ws.accessKey });
      if (st.body?.status === 'ready') break;
      if (st.body?.status === 'failed') throw new Error('seed ingest failed');
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return ws;
}

function multipart(workspaceId, filename, content) {
  const boundary = `----dociq${crypto.randomBytes(8).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="workspaceId"\r\n\r\n${workspaceId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function runStep(connections, ws, docText) {
  let n = 0;
  const common = { url: BASE, connections, duration, timeout: 30 };
  const opts =
    kind === 'query'
      ? {
          ...common,
          requests: [
            {
              method: 'POST',
              path: '/api/query',
              headers: { 'content-type': 'application/json', 'x-workspace-key': ws.accessKey },
              setupRequest: (req) => {
                n++;
                const q = questions[n % questions.length];
                // cache off: a unique suffix makes every question a cache miss (full retrieval + answer)
                const question = cacheMode === 'on' ? q : `${q} (load ${n})`;
                return { ...req, body: JSON.stringify({ workspaceId: ws._id, question }) };
              },
            },
          ],
        }
      : {
          ...common,
          requests: [
            {
              method: 'POST',
              path: '/api/documents/upload',
              setupRequest: (req) => {
                n++;
                const { body, contentType } = multipart(ws._id, `load-${n}.txt`, `${docText}\n\nLoad document ${n}.`);
                return { ...req, body, headers: { 'content-type': contentType, 'x-workspace-key': ws.accessKey } };
              },
            },
          ],
        };
  // Record every response time ourselves: autocannon's summary has p97.5 but no p95.
  const times = [];
  return new Promise((resolve, reject) => {
    const inst = autocannon(opts, (err, res) => (err ? reject(err) : resolve({ res, times })));
    inst.on('response', (_client, _status, _bytes, ms) => times.push(ms));
  });
}

const statusCount = (res, code) => res.statusCodeStats?.[code]?.count || 0;

try {
  await waitReady();
  const ws = await seedWorkspace();
  const docText = await fs.readFile(path.join(BACKEND, 'eval/corpus/far-52-232-25.txt'), 'utf8');
  const results = [];
  for (const c of steps) {
    const { res, times } = await runStep(c, ws, docText);
    times.sort((a, b) => a - b);
    const pq = (q) => (times.length ? Number(times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)].toFixed(1)) : null);
    const total = res.requests.total || 0;
    const non2xx = res.non2xx || 0;
    const errors = (res.errors || 0) + (res.timeouts || 0);
    const row = {
      connections: c,
      duration_s: duration,
      requests: total,
      rps: Number(res.requests.average.toFixed(1)),
      p50_ms: pq(0.5),
      p95_ms: pq(0.95),
      p99_ms: pq(0.99),
      max_ms: times.length ? Number(times.at(-1).toFixed(1)) : null,
      non2xx,
      errors,
      status_429: statusCount(res, 429),
      status_503: statusCount(res, 503),
      error_rate: total ? Number(((non2xx + errors) / total).toFixed(4)) : 1,
    };
    row.within_slo = row.p95_ms <= SLO[kind].p95Ms && row.error_rate < SLO.maxErrorRate;
    results.push(row);
    console.log(JSON.stringify(row));
    if (kind === 'ingest') {
      // let the bounded inline queue drain before the next step
      for (let i = 0; i < 600; i++) {
        const q = (await api('GET', '/readyz')).body?.queue?.inline;
        if (q && q.active === 0 && q.waiting === 0) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
  const ready = await api('GET', '/readyz');
  const docs = kind === 'ingest' ? (await api('GET', `/api/workspaces/${ws._id}/documents`, { key: ws.accessKey })).body : null; // ingested count
  const ok = results.filter((r) => r.within_slo);
  const capacity = ok.length ? ok[ok.length - 1] : null;

  const started = new Date();
  const stamp = started.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const runId = `${stamp}-load-${kind}${label ? `-${label}` : ''}`;
  const dir = path.join(ROOT, 'results', 'runs', runId);
  await fs.mkdir(dir, { recursive: true });
  const sh = (c) => {
    try {
      return execSync(c, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return null;
    }
  };
  const manifest = {
    run_id: runId,
    project: 'docIQ',
    started_at: started.toISOString(),
    git_sha: sh('git rev-parse HEAD'),
    git_dirty: Boolean(sh('git status --porcelain --untracked-files=no')),
    command: `cd backend && node loadtest/run.js ${args.join(' ')}`,
    language: `node ${process.version}`,
    tool: 'autocannon',
    host: { platform: `${os.platform()} ${os.release()}`, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memGb: Math.round(os.totalmem() / 2 ** 30) },
    setup: 'single API process; in-memory MongoDB (same host); VECTOR_STORE=memory; EMBEDDING_PROVIDER=local; LLM_PROVIDER=extractive; USE_QUEUE=false (bounded inline queue)',
    cache: kind === 'query' ? cacheMode : 'n/a',
    seed_corpus: `${corpus.length} public eval documents`,
    slo: SLO,
  };
  const metrics = {
    capacity: capacity ? { connections: capacity.connections, rps: capacity.rps, p95_ms: capacity.p95_ms } : null,
    steps: results,
    readyz_after: ready.body,
    ...(docs ? { documents_after: Array.isArray(docs) ? docs.length : docs?.documents?.length ?? null } : {}),
  };
  const L = [
    `# Load test — ${kind} path (${runId})`,
    '',
    `${manifest.setup}. Host: ${manifest.host.cpu}, ${manifest.host.cpus} logical CPUs, ${manifest.host.memGb} GB. Each step ${duration}s. SLO: p95 ≤ ${SLO[kind].p95Ms} ms and < 1% errors. Percentiles are nearest-rank over every response time recorded in the step.`,
    '',
    '| Connections | Requests | RPS | p50 ms | p95 ms | p99 ms | non-2xx | 429 | 503 | errors | within SLO |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.connections} | ${r.requests} | ${r.rps} | ${r.p50_ms} | ${r.p95_ms} | ${r.p99_ms} | ${r.non2xx} | ${r.status_429} | ${r.status_503} | ${r.errors} | ${r.within_slo ? 'yes' : 'no'} |`),
    '',
    capacity ? `Capacity (highest step within SLO): **${capacity.connections} connections, ${capacity.rps} req/s, p95 ${capacity.p95_ms} ms**.` : 'No step met the SLO.',
    '',
    `Command: \`${manifest.command}\``,
    '',
  ];
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await fs.writeFile(path.join(dir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  await fs.writeFile(path.join(dir, 'report.md'), L.join('\n'));
  console.log(L.join('\n'));
  console.log(`wrote results/runs/${runId}`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await stop();
}
