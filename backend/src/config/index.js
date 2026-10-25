import dotenv from 'dotenv';

dotenv.config();

const bool = (v, def = false) =>
  v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const num = (v, def) => (v === undefined || v === '' ? def : Number(v));

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN || '*',

  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/dociq',

  useQueue: bool(process.env.USE_QUEUE, false),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  seedDemo: bool(process.env.SEED_DEMO, false),

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
