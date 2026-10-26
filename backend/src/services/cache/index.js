import crypto from 'node:crypto';
import config from '../../config/index.js';

/**
 * Small caches with hit/miss counters (exported to /metrics).
 *
 *  - TTL-LRU in process memory (default). Bounded by entry count.
 *  - singleFlight(key, fn): concurrent misses for the same key share one computation
 *    (stampede protection), per instance.
 *  - Answer cache can use Redis (CACHE_DRIVER=redis) so all instances share it.
 */

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export class TtlLru {
  constructor({ max = 1000, ttlMs = 0 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const e = this.map.get(key);
    if (!e || (e.exp && e.exp < Date.now())) {
      if (e) this.map.delete(key);
      this.misses++;
      return undefined;
    }
    this.map.delete(key); // refresh LRU position
    this.map.set(key, e);
    this.hits++;
    return e.value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, exp: this.ttlMs ? Date.now() + this.ttlMs : 0 });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

const inflight = new Map();
export function singleFlight(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve()
    .then(fn)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Answer cache: memory LRU or Redis, JSON values, TTL from config. */
class AnswerCache {
  constructor() {
    this.mem = new TtlLru({ max: config.cache.answerMaxEntries, ttlMs: config.cache.answerTtlSec * 1000 });
    this.hits = 0;
    this.misses = 0;
  }

  async _redis() {
    if (config.cache.driver !== 'redis') return null;
    const { getRedis } = await import('../../config/redis.js');
    return getRedis();
  }

  async get(key) {
    const r = await this._redis();
    let v;
    if (r) {
      const raw = await r.get(key).catch(() => null); // cache outage → miss, never an error
      v = raw ? JSON.parse(raw) : undefined;
    } else v = this.mem.get(key);
    v === undefined ? this.misses++ : this.hits++;
    return v;
  }

  async set(key, value) {
    const r = await this._redis();
    if (r) await r.set(key, JSON.stringify(value), 'EX', config.cache.answerTtlSec).catch(() => {});
    else this.mem.set(key, value);
  }

  clear() {
    this.mem.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

export const answerCache = new AnswerCache();
export const embeddingCache = new TtlLru({ max: config.cache.embeddingMaxEntries });

/**
 * Tenant-scoped answer key. contentVersion changes on every ingest, delete and
 * settings change, so a cached answer can never outlive the documents it came from.
 */
export function answerKey({ workspaceId, contentVersion, question, settings }) {
  const q = String(question).toLowerCase().replace(/\s+/g, ' ').trim();
  return `ans:${workspaceId}:v${contentVersion || 0}:${sha256(JSON.stringify([q, settings || {}]))}`;
}

/** Wrap an embedding provider so identical texts are embedded once (keyed by provider + text hash). */
export function withEmbeddingCache(provider, cache = embeddingCache) {
  return {
    get name() {
      return provider.name;
    },
    get dim() {
      return provider.dim;
    },
    async embed(texts) {
      const keys = texts.map((t) => `${provider.name}:${provider.dim}:${sha256(t)}`);
      const out = keys.map((k) => cache.get(k));
      const missIdx = out.map((v, i) => (v === undefined ? i : -1)).filter((i) => i >= 0);
      if (missIdx.length) {
        const fresh = await provider.embed(missIdx.map((i) => texts[i]));
        missIdx.forEach((i, j) => {
          out[i] = fresh[j];
          cache.set(keys[i], fresh[j]);
        });
      }
      return out;
    },
  };
}

export function cacheStats() {
  const ratio = (h, m) => (h + m ? h / (h + m) : 0);
  return {
    answer: { hits: answerCache.hits, misses: answerCache.misses, hitRatio: ratio(answerCache.hits, answerCache.misses) },
    embedding: { hits: embeddingCache.hits, misses: embeddingCache.misses, hitRatio: ratio(embeddingCache.hits, embeddingCache.misses), size: embeddingCache.size },
  };
}
