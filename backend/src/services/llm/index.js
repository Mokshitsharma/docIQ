import config from '../../config/index.js';
import logger from '../../utils/logger.js';
import { GeminiProvider } from './gemini.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';
import { ExtractiveProvider } from './extractive.js';

const cache = new Map();

/**
 * Resolve an LLM provider by name. Falls back to `extractive` (no key needed)
 * whenever the requested provider can't be constructed.
 */
export function getLLMProvider(name = config.llmProvider) {
  if (cache.has(name)) return cache.get(name);

  let provider;
  try {
    switch (name) {
      case 'gemini':
        provider = new GeminiProvider({
          apiKey: config.gemini.apiKey,
          model: config.gemini.model,
        });
        break;
      case 'groq':
        provider = new OpenAICompatibleProvider({
          apiKey: config.groq.apiKey,
          baseUrl: 'https://api.groq.com/openai/v1',
          model: config.groq.model,
          label: 'groq',
        });
        break;
      case 'openai':
        provider = new OpenAICompatibleProvider({
          apiKey: config.openai.apiKey,
          baseUrl: config.openai.baseUrl,
          model: config.openai.model,
          label: 'openai',
        });
        break;
      case 'extractive':
      default:
        provider = new ExtractiveProvider();
    }
  } catch (err) {
    logger.warn(`LLM provider "${name}" unavailable (${err.message}); using extractive`);
    provider = new ExtractiveProvider();
  }

  cache.set(name, provider);
  return provider;
}

export default getLLMProvider;
