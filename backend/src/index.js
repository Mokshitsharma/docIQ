import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import mongoose from 'mongoose';
import config from './config/index.js';
import logger from './utils/logger.js';
import { connectDB } from './config/db.js';
import { notFound, errorHandler } from './middleware/error.js';
import { requestId } from './utils/requestContext.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { registry, metricsMiddleware, setQueueDepthSource } from './middleware/metrics.js';
import { queueDepth, closeQueues } from './queues/ingestionQueue.js';
import { cacheStats } from './services/cache/index.js';
import workspacesRouter from './routes/workspaces.js';
import documentsRouter from './routes/documents.js';
import queryRouter from './routes/query.js';

export function assertValidConfig(cfg = config) {
  if (cfg.env === 'production' && !cfg.workspaceAuth) {
    throw new Error('Refusing to start: WORKSPACE_AUTH cannot be disabled in production (NODE_ENV=production)');
  }
}

export function createApp() {
  assertValidConfig(config);
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(requestId);
  app.use(metricsMiddleware);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  const origins = config.corsOrigin === '*' ? null : config.corsOrigin.split(',').map((s) => s.trim());
  if (!origins && config.env === 'production') logger.warn('CORS_ORIGIN=* in production; set an explicit allowlist');
  app.use(
    cors({
      origin: origins || true,
      allowedHeaders: ['content-type', 'x-workspace-key', 'x-request-id', 'idempotency-key'],
      exposedHeaders: ['x-request-id', 'retry-after'],
    })
  );
  app.use(express.json({ limit: '100kb' }));
  // Strip $-operators and dotted keys from body/query/params (NoSQL injection).
  app.use(mongoSanitize({ replaceWith: '_' }));

  // Liveness: process is up. Readiness: dependencies reachable (load balancer target).
  const health = (_req, res) =>
    res.json({
      ok: true,
      env: config.env,
      llmProvider: config.llmProvider,
      embeddingProvider: config.embeddingProvider,
      vectorStore: config.vectorStore,
      queue: config.useQueue ? 'bullmq' : 'inline',
      storage: config.storage.driver,
    });
  app.get('/health', health);
  app.get('/livez', (_req, res) => res.json({ ok: true }));
  app.get('/readyz', async (_req, res) => {
    const mongo = mongoose.connection.readyState === 1;
    const depth = await queueDepth().catch(() => null);
    res.status(mongo && !shuttingDown ? 200 : 503).json({ ok: mongo && !shuttingDown, mongo, shuttingDown, queue: depth, cache: cacheStats() });
  });
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  app.use('/api', globalLimiter);
  app.use('/api/workspaces', workspacesRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/query', queryRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

let shuttingDown = false;
setQueueDepthSource(queueDepth);

async function start() {
  await connectDB();
  const app = createApp();
  const server = app.listen(config.port, async () => {
    logger.info(`DocIQ API on http://localhost:${config.port}`);
    logger.info(
      `providers: llm:${config.llmProvider} embed:${config.embeddingProvider} vector:${config.vectorStore} queue:${config.useQueue ? 'bullmq' : 'inline'} storage:${config.storage.driver}`
    );
    if (config.vectorStore === 'memory') {
      const { rehydrateVectorStore } = await import('./services/retrieval/rehydrate.js');
      await rehydrateVectorStore().catch((err) => logger.error('vector store rehydrate failed:', err.message));
    }
    if (config.seedDemo) {
      const { seedDemo } = await import('./config/seed.js');
      await seedDemo();
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 61_000; // > ALB idle timeout (60 s)

  // Graceful shutdown: fail readiness, stop accepting, drain in-flight requests, close pools.
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, draining`);
    const force = setTimeout(() => process.exit(1), config.timeouts.shutdownMs);
    force.unref();
    server.close(async () => {
      await closeQueues().catch(() => {});
      await mongoose.disconnect().catch(() => {});
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only auto-start when run directly (not when imported by tests/eval).
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  start().catch((err) => {
    logger.error('failed to start:', err.message);
    process.exit(1);
  });
}

export default createApp;
