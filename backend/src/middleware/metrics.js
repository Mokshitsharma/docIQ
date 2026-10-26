import client from 'prom-client';
import { cacheStats } from '../services/cache/index.js';

/** Prometheus metrics: request rate / errors / duration (RED), cache hit ratios, queue depth. */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

new client.Gauge({
  name: 'dociq_cache_hit_ratio',
  help: 'Cache hit ratio since process start',
  labelNames: ['cache'],
  registers: [registry],
  collect() {
    const s = cacheStats();
    this.set({ cache: 'answer' }, s.answer.hitRatio);
    this.set({ cache: 'embedding' }, s.embedding.hitRatio);
  },
});

let queueDepthFn = async () => ({});
export const setQueueDepthSource = (fn) => {
  queueDepthFn = fn;
};
new client.Gauge({
  name: 'dociq_queue_depth',
  help: 'Ingestion queue depth by state',
  labelNames: ['queue', 'state'],
  registers: [registry],
  async collect() {
    const depth = await queueDepthFn().catch(() => ({}));
    for (const [queue, states] of Object.entries(depth)) {
      for (const [state, n] of Object.entries(states)) this.set({ queue, state }, n);
    }
  },
});

export function metricsMiddleware(req, res, next) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    // Route template (not the raw URL) keeps label cardinality bounded.
    const route = req.route ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'unmatched';
    end({ method: req.method, route, status: res.statusCode });
  });
  next();
}
