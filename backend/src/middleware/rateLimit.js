import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import config from '../config/index.js';

/**
 * Sliding-window rate limits (express-rate-limit). With RATE_LIMIT_STORE=redis
 * the counters live in Redis, so the limits hold across all API instances.
 * Exceeding a limit returns 429 with a Retry-After header.
 *
 *   global  per IP, every /api route
 *   query   per tenant (workspaceId) — the expensive route (retrieval + LLM)
 *   upload  per IP — parsing/embedding is the most expensive write
 */

let redisStoreFactory = null;
async function makeStore(prefix) {
  if (config.rateLimit.store !== 'redis') return undefined;
  if (!redisStoreFactory) {
    const { RedisStore } = await import('rate-limit-redis');
    const { getRedis } = await import('../config/redis.js');
    const client = getRedis();
    redisStoreFactory = (p) => new RedisStore({ prefix: p, sendCommand: (...args) => client.call(...args) });
  }
  return redisStoreFactory(prefix);
}

const stores = {
  global: await makeStore('rl:global:'),
  query: await makeStore('rl:query:'),
  upload: await makeStore('rl:upload:'),
};

const common = {
  windowMs: config.rateLimit.windowMs,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: (req, res) => ({ error: 'Too many requests, slow down', retryAfterSec: Number(res.get('Retry-After')) || undefined }),
};

const ipKey = (req) => ipKeyGenerator(req.ip || '');

export const globalLimiter = rateLimit({ ...common, limit: config.rateLimit.globalPerIp, store: stores.global, keyGenerator: ipKey });

export const queryLimiter = rateLimit({
  ...common,
  limit: config.rateLimit.queryPerTenant,
  store: stores.query,
  keyGenerator: (req) => `ws:${String(req.body?.workspaceId || '').slice(0, 24)}|${ipKey(req)}`,
});

export const uploadLimiter = rateLimit({ ...common, limit: config.rateLimit.uploadPerTenant, store: stores.upload, keyGenerator: ipKey });
