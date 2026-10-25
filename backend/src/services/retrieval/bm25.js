/**
 * Okapi BM25 over an in-memory list of texts (full-corpus keyword retrieval).
 *
 *   const index = new BM25Index(texts);
 *   index.search('termination notice', 5) // → [{ index, score }]
 *
 * Standard formulation: idf = ln(1 + (N - df + 0.5) / (df + 0.5)),
 * term weight = idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * len / avgLen)).
 */

const STOPWORDS = new Set(
  ('a an and are as at be by for from has have if in into is it its of on or that the their then ' +
    'there these this to was were will with what which who whom how when where does do did can may ' +
    'must shall should would could under any all such').split(' ')
);

export function bm25Tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9$.\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export class BM25Index {
  constructor(texts, { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.docs = texts.map((t) => {
      const tf = new Map();
      const toks = bm25Tokenize(t);
      for (const w of toks) tf.set(w, (tf.get(w) || 0) + 1);
      return { tf, len: toks.length };
    });
    this.N = this.docs.length;
    this.avgLen = this.docs.reduce((n, d) => n + d.len, 0) / Math.max(this.N, 1) || 1;
    this.df = new Map();
    for (const d of this.docs) for (const w of d.tf.keys()) this.df.set(w, (this.df.get(w) || 0) + 1);
  }

  idf(term) {
    const df = this.df.get(term) || 0;
    return Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
  }

  score(query) {
    const terms = [...new Set(bm25Tokenize(query))];
    return this.docs.map((d) => {
      let s = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (!f) continue;
        s += (this.idf(t) * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avgLen));
      }
      return s;
    });
  }

  /** Top-k documents by BM25 score; ties broken by index for determinism. Zero-score docs are dropped. */
  search(query, topK = 5) {
    return this.score(query)
      .map((score, index) => ({ index, score }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, topK);
  }
}

export default BM25Index;
