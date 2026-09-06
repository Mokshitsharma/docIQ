import { LLMProvider } from './base.js';

/**
 * Works with any OpenAI-compatible /chat/completions endpoint:
 * OpenAI, Groq, Together, OpenRouter, local vLLM/Ollama, etc.
 */
export class OpenAICompatibleProvider extends LLMProvider {
  constructor({ apiKey, baseUrl, model, label = 'openai' }) {
    super();
    if (!apiKey) throw new Error(`API key required for ${label} LLM`);
    this._apiKey = apiKey;
    this._baseUrl = baseUrl.replace(/\/$/, '');
    this._model = model;
    this._label = label;
  }

  get name() {
    return this._label;
  }

  async complete({ system, prompt, temperature = 0.1, maxTokens = 1024, json = false }) {
    const body = {
      model: this._model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    };
    if (json) body.response_format = { type: 'json_object' };

    const res = await fetch(`${this._baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${this._label} LLM ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
}
