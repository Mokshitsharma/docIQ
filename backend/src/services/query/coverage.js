import { bm25Tokenize } from '../retrieval/bm25.js';

/**
 * Query-term coverage: how much of the question's (idf-weighted) vocabulary
 * appears in the best single retrieved chunk. idf is computed over the
 * retrieved chunks themselves, so a question term that appears in none of them
 * (e.g. "encryption" against breach-notification text) weighs the most.
 * Returns a value in [0, 1]; 0 when there are no chunks or no content terms.
 */
export function queryCoverage(question, chunks) {
  const terms = [...new Set(bm25Tokenize(question))];
  if (!terms.length || !chunks.length) return 0;
  const sets = chunks.map((c) => new Set(bm25Tokenize(c.text)));
  const N = sets.length;
  const w = terms.map((t) => {
    const df = sets.filter((s) => s.has(t)).length;
    return Math.log(1 + (N - df + 0.5) / (df + 0.5));
  });
  const total = w.reduce((a, b) => a + b, 0);
  let best = 0;
  for (const s of sets) {
    let got = 0;
    terms.forEach((t, i) => {
      if (s.has(t)) got += w[i];
    });
    best = Math.max(best, got / total);
  }
  return best;
}

export default queryCoverage;
