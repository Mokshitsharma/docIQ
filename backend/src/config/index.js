import dotenv from 'dotenv';

dotenv.config();

const bool = (v, def = false) =>
  v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const num = (v, def) => (v === undefined || v === '' ? def : Number(v));

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  // Number of reverse-proxy hops to trust for req.ip (1 behind nginx / an ALB). 0 = none.
  trustProxy: num(process.env.TRUST_PROXY, 0),
  // Structured JSON logs (one object per line). Defaults on in production.
  logFormat: process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'text'),
  logLevel: process.env.LOG_LEVEL || 'info',

  // Tenant isolation: every workspace-scoped call must send X-Workspace-Key (returned once on create).
  // Set WORKSPACE_AUTH=false only for a trusted single-user demo.
  workspaceAuth: bool(process.env.WORKSPACE_AUTH, true),

  rateLimit: {
    store: process.env.RATE_LIMIT_STORE || 'memory', // memory | redis (shared across instances)
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    globalPerIp: num(process.env.RATE_LIMIT_GLOBAL, 300),
    queryPerTenant: num(process.env.RATE_LIMIT_QUERY, 30),
    uploadPerTenant: num(process.env.RATE_LIMIT_UPLOAD, 10),
  },

  uploads: {
    maxBytes: num(process.env.UPLOAD_MAX_BYTES, 25 * 1024 * 1024),
    maxPdfPages: num(process.env.UPLOAD_MAX_PDF_PAGES, 500),
    maxUncompressedBytes: num(process.env.UPLOAD_MAX_UNCOMPRESSED_BYTES, 100 * 1024 * 1024),
    maxZipEntries: num(process.env.UPLOAD_MAX_ZIP_ENTRIES, 2000),
    maxCompressionRatio: num(process.env.UPLOAD_MAX_COMPRESSION_RATIO, 100),
    maxTextChars: num(process.env.UPLOAD_MAX_TEXT_CHARS, 5_000_000),
    parseTimeoutMs: num(process.env.UPLOAD_PARSE_TIMEOUT_MS, 60_000),
  },

  storage: {
    driver: process.env.STORAGE_DRIVER || 'local', // local | s3
    s3Bucket: process.env.S3_BUCKET || '',
    s3Region: process.env.AWS_REGION || 'us-east-1',
    s3Prefix: process.env.S3_PREFIX || 'uploads/',
    signedUrlTtlSec: num(process.env.SIGNED_URL_TTL_SEC, 300),
  },

  // Optional: mask emails, phone numbers, SSNs and card numbers in stored query logs and app logs.
  redactPII: bool(process.env.REDACT_PII, false),

  quotas: {
    maxDocsPerWorkspace: num(process.env.QUOTA_MAX_DOCS, 200),
    maxQueriesPerDay: num(process.env.QUOTA_MAX_QUERIES_PER_DAY, 2000),
    llmDailyBudgetUsd: num(process.env.LLM_DAILY_BUDGET_USD, 1),
  },

  cache: {
    driver: process.env.CACHE_DRIVER || 'memory', // memory | redis
    answerTtlSec: num(process.env.ANSWER_CACHE_TTL_SEC, 600),
    answerMaxEntries: num(process.env.ANSWER_CACHE_MAX, 1000),
    embeddingMaxEntries: num(process.env.EMBEDDING_CACHE_MAX, 20000),
  },

  queue: {
    maxDepth: num(process.env.QUEUE_MAX_DEPTH, 100),
    inlineConcurrency: num(process.env.INLINE_INGEST_CONCURRENCY, 2),
  },

  timeouts: {
    llmMs: num(process.env.LLM_TIMEOUT_MS, 30_000),
    embedMs: num(process.env.EMBED_TIMEOUT_MS, 15_000),
    vectorMs: num(process.env.VECTOR_TIMEOUT_MS, 5_000),
    shutdownMs: num(process.env.SHUTDOWN_TIMEOUT_MS, 10_000),
  },

  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/dociq',

  useQueue: bool(process.env.USE_QUEUE, false),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  seedDemo: bool(process.env.SEED_DEMO, false),
  // Published key of the seeded demo workspace (public on purpose; the demo is read-only).
  demoWorkspaceKey: process.env.DEMO_WORKSPACE_KEY || 'demo-public-key',

  vectorStore: process.env.VECTOR_STORE || 'memory',
  chromaUrl: process.env.CHROMA_URL || 'http://localhost:8000',
  chromaCollection: process.env.CHROMA_COLLECTION || 'dociq',

  llmProvider: process.env.LLM_PROVIDER || 'extractive',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },

  embeddingProvider: process.env.EMBEDDING_PROVIDER || 'local',
  embeddingDim: num(process.env.EMBEDDING_DIM, 384),

  defaults: {
    chunkSize: num(process.env.DEFAULT_CHUNK_SIZE, 800),
    chunkOverlap: num(process.env.DEFAULT_CHUNK_OVERLAP, 100),
    topK: num(process.env.DEFAULT_TOP_K, 5),
    retrievalStrategy: process.env.DEFAULT_RETRIEVAL_STRATEGY || 'vector',
    confidenceThreshold: num(process.env.DEFAULT_CONFIDENCE_THRESHOLD, 0.15),
    // Refuse when the best chunk covers less than this share of the question's idf-weighted terms.
    // Chosen on the dev split only (eval/tune-gate.js → eval/results/gate-tuning.json).
    minQueryCoverage: num(process.env.DEFAULT_MIN_QUERY_COVERAGE, 0.3),
  },
};

export default config;
