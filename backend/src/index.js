import express from 'express';
import cors from 'cors';
import config from './config/index.js';
import logger from './utils/logger.js';
import { connectDB } from './config/db.js';
import { notFound, errorHandler } from './middleware/error.js';
import workspacesRouter from './routes/workspaces.js';
import documentsRouter from './routes/documents.js';
import queryRouter from './routes/query.js';

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) =>
    res.json({
      ok: true,
      env: config.env,
      llmProvider: config.llmProvider,
      embeddingProvider: config.embeddingProvider,
      vectorStore: config.vectorStore,
      queue: config.useQueue ? 'bullmq' : 'inline',
    })
  );

  app.use('/api/workspaces', workspacesRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/query', queryRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

async function start() {
  await connectDB();
  const app = createApp();
  app.listen(config.port, async () => {
    logger.info(`DocIQ API on http://localhost:${config.port}`);
    logger.info(
      `providers → llm:${config.llmProvider} embed:${config.embeddingProvider} vector:${config.vectorStore} queue:${config.useQueue ? 'bullmq' : 'inline'}`
    );
    if (config.seedDemo) {
      const { seedDemo } = await import('./config/seed.js');
      await seedDemo();
    }
  });
}

// Only auto-start when run directly (not when imported by tests/eval).
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  start().catch((err) => {
    logger.error('failed to start:', err.message);
    process.exit(1);
  });
}

export default createApp;
