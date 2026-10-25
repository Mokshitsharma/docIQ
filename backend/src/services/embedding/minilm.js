import { EmbeddingProvider } from './base.js';

/**
 * Local neural sentence embeddings: sentence-transformers/all-MiniLM-L6-v2
 * (ONNX port "Xenova/all-MiniLM-L6-v2", Apache-2.0) run on CPU via
 * @huggingface/transformers. Free, no API key; the ~23 MB model is downloaded
 * from the Hugging Face Hub on first use and cached locally.
 *
 * @huggingface/transformers is a devDependency (kept out of production installs; it pulls in sharp) — if it is not installed,
 * embed() throws with an explanatory message.
 */
export class MiniLMEmbeddingProvider extends EmbeddingProvider {
  constructor({ model = 'Xenova/all-MiniLM-L6-v2', batchSize = 16 } = {}) {
    super();
    this.model = model;
    this.batchSize = batchSize;
    this._extractor = null;
  }

  get name() {
    return 'minilm';
  }

  get dim() {
    return 384;
  }

  async _load() {
    if (this._extractor) return this._extractor;
    let lib;
    try {
      lib = await import('@huggingface/transformers');
    } catch (err) {
      throw new Error(
        `minilm embeddings need the dev package @huggingface/transformers (npm install, without --omit=dev): ${err.message}`
      );
    }
    this._extractor = await lib.pipeline('feature-extraction', this.model, { dtype: 'fp32' });
    return this._extractor;
  }

  async embed(texts) {
    const extractor = await this._load();
    const out = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const t = await extractor(batch, { pooling: 'mean', normalize: true });
      out.push(...t.tolist());
    }
    return out;
  }
}

export async function isMiniLMAvailable() {
  try {
    await import('@huggingface/transformers');
    return true;
  } catch {
    return false;
  }
}
