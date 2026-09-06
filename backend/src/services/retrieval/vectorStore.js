import config from '../../config/index.js';
import logger from '../../utils/logger.js';

/**
 * Minimal vector-store interface used by the app:
 *
 *   upsert(items: {id, vector, metadata}[]): Promise<void>
 *   query(vector, { topK, filter }): Promise<{id, score, metadata}[]>
 *   deleteByFilter(filter): Promise<void>
 *
 * `score` is cosine similarity in [-1, 1]; higher is better.
 */

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are stored L2-normalised
}

function matchesFilter(metadata, filter) {
  if (!filter) return true;
  return Object.entries(filter).every(([k, v]) => String(metadata?.[k]) === String(v));
}

class MemoryVectorStore {
  constructor() {
    this.items = new Map(); // id -> { vector, metadata }
  }

  async upsert(items) {
    for (const it of items) this.items.set(it.id, { vector: it.vector, metadata: it.metadata || {} });
  }

  async query(vector, { topK = 5, filter } = {}) {
    const scored = [];
    for (const [id, { vector: v, metadata }] of this.items) {
      if (!matchesFilter(metadata, filter)) continue;
      scored.push({ id, score: cosine(vector, v), metadata });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async deleteByFilter(filter) {
    for (const [id, { metadata }] of this.items) {
      if (matchesFilter(metadata, filter)) this.items.delete(id);
    }
  }
}

/**
 * Chroma via its REST API (v1). Kept dependency-free with fetch so we don't
 * pin a client version. Collection is created lazily.
 */
class ChromaVectorStore {
  constructor({ url, collection }) {
    this.url = url.replace(/\/$/, '');
    this.collectionName = collection;
    this.collectionId = null;
  }

  async _ensureCollection() {
    if (this.collectionId) return this.collectionId;
    const res = await fetch(`${this.url}/api/v1/collections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: this.collectionName, get_or_create: true }),
    });
    if (!res.ok) throw new Error(`Chroma create collection ${res.status}: ${await res.text()}`);
    const data = await res.json();
    this.collectionId = data.id;
    return this.collectionId;
  }

  async upsert(items) {
    const id = await this._ensureCollection();
    const res = await fetch(`${this.url}/api/v1/collections/${id}/upsert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ids: items.map((i) => i.id),
        embeddings: items.map((i) => i.vector),
        metadatas: items.map((i) => i.metadata || {}),
        documents: items.map((i) => i.metadata?.text ?? ''),
      }),
    });
    if (!res.ok) throw new Error(`Chroma upsert ${res.status}: ${await res.text()}`);
  }

  async query(vector, { topK = 5, filter } = {}) {
    const id = await this._ensureCollection();
    const body = { query_embeddings: [vector], n_results: topK, include: ['metadatas', 'distances'] };
    if (filter) body.where = filter;
    const res = await fetch(`${this.url}/api/v1/collections/${id}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Chroma query ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const ids = data.ids?.[0] || [];
    return ids.map((cid, i) => ({
      id: cid,
      // Chroma returns squared-L2 distance for normalised vectors → cos ≈ 1 - d/2
      score: 1 - (data.distances?.[0]?.[i] ?? 2) / 2,
      metadata: data.metadatas?.[0]?.[i] || {},
    }));
  }

  async deleteByFilter(filter) {
    const id = await this._ensureCollection();
    const res = await fetch(`${this.url}/api/v1/collections/${id}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ where: filter }),
    });
    if (!res.ok) throw new Error(`Chroma delete ${res.status}: ${await res.text()}`);
  }
}

let store = null;

export function getVectorStore() {
  if (store) return store;
  if (config.vectorStore === 'chroma') {
    logger.info(`Vector store: chroma (${config.chromaUrl})`);
    store = new ChromaVectorStore({ url: config.chromaUrl, collection: config.chromaCollection });
  } else {
    logger.info('Vector store: in-memory');
    store = new MemoryVectorStore();
  }
  return store;
}

export { MemoryVectorStore, ChromaVectorStore, cosine };
export default getVectorStore;
