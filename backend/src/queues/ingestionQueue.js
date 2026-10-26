import { Queue } from 'bullmq';
import config from '../config/index.js';
import { getRedis } from '../config/redis.js';
import logger from '../utils/logger.js';
import { ingestDocument } from '../services/ingestion/index.js';

export const INGESTION_QUEUE = 'dociq-ingestion';
export const DEAD_LETTER_QUEUE = 'dociq-ingestion-dlq';

let queue = null;
let dlq = null;

function getQueue() {
  if (!config.useQueue) return null;
  if (queue) return queue;
  queue = new Queue(INGESTION_QUEUE, { connection: getRedis() });
  return queue;
}

export function getDeadLetterQueue() {
  if (!config.useQueue) return null;
  if (dlq) return dlq;
  dlq = new Queue(DEAD_LETTER_QUEUE, { connection: getRedis() });
  return dlq;
}

const queueFull = (depth) =>
  Object.assign(new Error(`ingestion queue is full (${depth} waiting), retry later`), {
    status: 503,
    code: 'queue_full',
    retryAfterSec: 30,
  });

// Inline mode (no Redis): a bounded in-process queue with fixed concurrency.
const inline = { active: 0, waiting: [], failed: 0 };
function runInline(documentId) {
  const pending = inline.active + inline.waiting.length;
  if (pending >= config.queue.maxDepth) throw queueFull(pending);
  const job = () => {
    inline.active++;
    ingestDocument(documentId)
      .catch((err) => {
        inline.failed++;
        logger.error(`inline ingestion failed for ${documentId}: ${err.message}`);
      })
      .finally(() => {
        inline.active--;
        const next = inline.waiting.shift();
        if (next) next();
      });
  };
  if (inline.active < config.queue.inlineConcurrency) job();
  else inline.waiting.push(job);
}

/**
 * Enqueue a document for ingestion. Rejects with 503 + Retry-After when the
 * queue already holds QUEUE_MAX_DEPTH jobs (back-pressure instead of unbounded growth).
 * Job id = document id, so a retried upload request cannot enqueue the same document twice.
 */
export async function enqueueIngestion(documentId) {
  const q = getQueue();
  if (q) {
    const waiting = await q.getWaitingCount();
    if (waiting >= config.queue.maxDepth) throw queueFull(waiting);
    await q.add(
      'ingest',
      { documentId: String(documentId) },
      {
        jobId: String(documentId),
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      }
    );
    return { mode: 'queued' };
  }
  runInline(documentId);
  return { mode: 'inline' };
}

/** Queue depth for /readyz and /metrics. */
export async function queueDepth() {
  const q = getQueue();
  if (!q) {
    return { inline: { active: inline.active, waiting: inline.waiting.length, failed: inline.failed } };
  }
  const [main, dead] = await Promise.all([
    q.getJobCounts('waiting', 'active', 'delayed', 'failed'),
    getDeadLetterQueue().getJobCounts('waiting'),
  ]);
  return { [INGESTION_QUEUE]: main, [DEAD_LETTER_QUEUE]: dead };
}

export async function closeQueues() {
  await Promise.all([queue?.close(), dlq?.close()]);
}

export const _inlineStateForTests = inline;

export default enqueueIngestion;
