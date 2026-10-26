import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import config from '../config/index.js';
import { connectDB } from '../config/db.js';
import { getRedis } from '../config/redis.js';
import logger from '../utils/logger.js';
import { ingestDocument } from '../services/ingestion/index.js';
import { INGESTION_QUEUE, getDeadLetterQueue, closeQueues } from './ingestionQueue.js';

/**
 * Standalone ingestion worker (the "worker" role). Run with `npm run worker`
 * alongside the API when USE_QUEUE=true. Jobs that fail all attempts are copied
 * to the dead-letter queue `dociq-ingestion-dlq` for inspection / replay.
 */
async function main() {
  if (!config.useQueue) {
    logger.warn('USE_QUEUE=false: worker not needed; ingestion runs inline in the API process.');
    process.exit(0);
  }

  await connectDB();

  const worker = new Worker(
    INGESTION_QUEUE,
    async (job) => {
      logger.info(`ingesting document ${job.data.documentId} (job ${job.id}, attempt ${job.attemptsMade + 1})`);
      return ingestDocument(job.data.documentId);
    },
    { connection: getRedis(), concurrency: config.queue.inlineConcurrency }
  );

  worker.on('completed', (job, res) => logger.info(`job ${job.id} done: ${JSON.stringify(res)}`));
  worker.on('failed', async (job, err) => {
    logger.error(`job ${job?.id} failed: ${err.message}`);
    if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
      await getDeadLetterQueue()
        .add('dead', { ...job.data, error: err.message, failedAt: new Date().toISOString() }, { jobId: `dlq-${job.id}` })
        .catch((e) => logger.error(`could not dead-letter job ${job.id}: ${e.message}`));
    }
  });

  const shutdown = async () => {
    logger.info('worker draining');
    await worker.close(); // waits for active jobs
    await closeQueues();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  logger.info('Ingestion worker ready');
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
