import { Queue } from 'bullmq';
import config from '../config/index.js';
import { getRedis } from '../config/redis.js';
import logger from '../utils/logger.js';
import { ingestDocument } from '../services/ingestion/index.js';

export const INGESTION_QUEUE = 'dociq:ingestion';

let queue = null;

function getQueue() {
  if (!config.useQueue) return null;
  if (queue) return queue;
  queue = new Queue(INGESTION_QUEUE, { connection: getRedis() });
  return queue;
}

/**
 * Enqueue a document for ingestion. When USE_QUEUE=false, runs the pipeline
 * inline (fire-and-forget) so the API stays responsive without Redis.
 */
export async function enqueueIngestion(documentId) {
  const q = getQueue();
  if (q) {
    await q.add('ingest', { documentId: String(documentId) }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
    return { mode: 'queued' };
  }

  // Synchronous fallback
  ingestDocument(documentId).catch((err) =>
    logger.error(`inline ingestion failed for ${documentId}: ${err.message}`)
  );
  return { mode: 'inline' };
}

export default enqueueIngestion;
