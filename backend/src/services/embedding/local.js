import crypto from 'node:crypto';
import { EmbeddingProvider, l2normalize } from './base.js';

/**
 * Deterministic, dependency-free embeddings.
 *
 * Hashed bag-of-words with sub-word shingles projected into a fixed-dim space,
 * plus sign hashing to reduce collisions. Not semantically strong, but stable
 * and good enough to exercise the full retrieval pipeline offline and in evals.
 */
export class LocalEmbeddingProvider extends EmbeddingProvider {
  constructor(dim = 384) {
    super();
    this._dim = dim;
  }

  get name() {
    return 'local';
  }

  get dim() {
    return this._dim;
  }

  _hash(token) {
    const h = crypto.createHash('md5').update(token).digest();
    const bucket = h.readUInt32LE(0) % this._dim;
    const sign = h[4] & 1 ? 1 : -1;
    return { bucket, sign };
  }

  _tokenize(text) {
    const words = (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && w.length < 40);
    const tokens = [];
    for (const w of words) {
      tokens.push(w);
      // character trigram shingles give partial fuzzy matching
      for (let i = 0; i + 3 <= w.length; i++) tokens.push('#' + w.slice(i, i + 3));
    }
    return tokens;
  }

  _embedOne(text) {
    const vec = new Array(this._dim).fill(0);
    const tokens = this._tokenize(text);
    for (const t of tokens) {
      const { bucket, sign } = this._hash(t);
      vec[bucket] += sign;
    }
    return l2normalize(vec);
  }

  async embed(texts) {
    return texts.map((t) => this._embedOne(t));
  }
}
