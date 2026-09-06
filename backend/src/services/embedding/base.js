/**
 * EmbeddingProvider interface.
 *
 *   embed(texts: string[]): Promise<number[][]>   // one vector per input text
 *   readonly name: string
 *   readonly dim: number
 *
 * Implementations must return L2-normalised vectors so cosine similarity
 * reduces to a dot product downstream.
 */
export class EmbeddingProvider {
  get name() {
    return 'base';
  }

  get dim() {
    return 0;
  }

  // eslint-disable-next-line no-unused-vars
  async embed(texts) {
    throw new Error('EmbeddingProvider.embed not implemented');
  }
}

export function l2normalize(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}
