import { Worker } from 'bullmq';
import config from '../config/index.js';
import { connectDB } from '../config/db.js';
import { getRedis } from '../config/redis.js';
import logger from '../utils/logger.js';
import { ingestDocument } from '../services/ingestion/index.js';
import { INGESTION_QUEUE } from './ingestionQueue.js';

/**
 * Standalone ingestion worker. Run with `npm run worker` alongside the API
 * when USE_QUEUE=true.
 */
async function main() {
  if (!config.useQueue) {
    logger.warn('USE_QUEUE=false — worker not needed; ingestion runs inline in the API process.');
    process.exit(0);
  }

  await connectDB();

  const worker = new Worker(
    INGESTION_QUEUE,
    async (job) => {
      logger.info(`ingesting document ${job.data.documentId} (job ${job.id})`);
      return ingestDocument(job.data.documentId);
    },
    { connection: getRedis(), concurrency: 2 }
  );

  worker.on('completed', (job, res) =>
    logger.info(`job ${job.id} done: ${JSON.stringify(res)}`)
  );
  worker.on('failed', (job, err) =>
    logger.error(`job ${job?.id} failed: ${err.message}`)
  );

  logger.info('Ingestion worker ready');
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
