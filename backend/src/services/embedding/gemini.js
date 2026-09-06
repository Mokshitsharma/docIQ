import { GoogleGenerativeAI } from '@google/generative-ai';
import { EmbeddingProvider, l2normalize } from './base.js';

export class GeminiEmbeddingProvider extends EmbeddingProvider {
  constructor({ apiKey, model = 'text-embedding-004' }) {
    super();
    if (!apiKey) throw new Error('GEMINI_API_KEY required for gemini embeddings');
    this._model = model;
    this._client = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model });
    // text-embedding-004 → 768 dims
    this._dim = 768;
  }

  get name() {
    return 'gemini';
  }

  get dim() {
    return this._dim;
  }

  async embed(texts) {
    const out = [];
    // batchEmbedContents keeps request count low
    const requests = texts.map((t) => ({ content: { parts: [{ text: t }] } }));
    const res = await this._client.batchEmbedContents({ requests });
    for (const e of res.embeddings) {
      const v = e.values || [];
      this._dim = v.length || this._dim;
      out.push(l2normalize(v));
    }
    return out;
  }
}
