import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider } from './base.js';

export class GeminiProvider extends LLMProvider {
  constructor({ apiKey, model = 'gemini-1.5-flash' }) {
    super();
    if (!apiKey) throw new Error('GEMINI_API_KEY required for gemini LLM');
    this._model = model;
    this._client = new GoogleGenerativeAI(apiKey);
  }

  get name() {
    return 'gemini';
  }

  async complete({ system, prompt, temperature = 0.1, maxTokens = 1024, json = false }) {
    const model = this._client.getGenerativeModel({
      model: this._model,
      systemInstruction: system || undefined,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        responseMimeType: json ? 'application/json' : 'text/plain',
      },
    });
    const res = await model.generateContent(prompt);
    return res.response.text();
  }
}
