import Chunk from '../../models/Chunk.js';
import { getEmbeddingProvider } from '../embedding/index.js';
import { getVectorStore } from './vectorStore.js';

/**
 * Retrieve the most relevant chunks for a question within a workspace.
 *
 * strategy:
 *   "vector" — pure semantic similarity
 *   "hybrid" — semantic similarity blended with a BM25-lite keyword score,
 *              which helps exact terms (dates, amounts, defined terms)
 *
 * Returns chunks hydrated from Mongo, each with a normalised `score` in [0,1].
 */
export async function retrieve(question, {
  workspaceId,
  topK = 5,
  strategy = 'vector',
  embeddingProvider,
} = {}) {
  const embedder = getEmbeddingProvider(embeddingProvider);
  const store = getVectorStore();

  const [qVec] = await embedder.embed([question]);
  const overFetch = strategy === 'hybrid' ? topK * 4 : topK;
  const hits = await store.query(qVec, {
    topK: overFetch,
    filter: { workspaceId: String(workspaceId) },
  });

  if (hits.length === 0) return [];

  const chunkIds = hits.map((h) => h.metadata?.chunkId).filter(Boolean);
  const chunks = await Chunk.find({ _id: { $in: chunkIds } }).lean();
  const byId = new Map(chunks.map((c) => [String(c._id), c]));

  let scored = hits
    .map((h) => {
      const chunk = byId.get(String(h.metadata?.chunkId));
      if (!chunk) return null;
      return { chunk, vectorScore: clamp01((h.score + 1) / 2) };
    })
    .filter(Boolean);

  if (strategy === 'hybrid') {
    const kwScores = keywordScores(question, scored.map((s) => s.chunk));
    scored = scored.map((s, i) => ({
      ...s,
      score: 0.7 * s.vectorScore + 0.3 * kwScores[i],
    }));
  } else {
    scored = scored.map((s) => ({ ...s, score: s.vectorScore }));
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => ({
    ...s.chunk,
    score: Number(s.score.toFixed(4)),
  }));
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/** BM25-lite: idf-weighted term frequency, normalised to [0,1] across the candidate set. */
function keywordScores(question, chunks) {
  const qTerms = tokenize(question);
  if (qTerms.length === 0) return chunks.map(() => 0);

  const N = chunks.length || 1;
  const df = new Map();
  const docTokens = chunks.map((c) => tokenize(c.text));
  for (const toks of docTokens) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  }

  const raw = docTokens.map((toks) => {
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const qt of qTerms) {
      const f = tf.get(qt) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(qt) || 0) + 0.5) / ((df.get(qt) || 0) + 0.5));
      score += idf * (f / (f + 1.5));
    }
    return score;
  });

  const max = Math.max(...raw, 1e-9);
  return raw.map((s) => s / max);
}

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.$/-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

export default retrieve;
