import config from '../../config/index.js';
import logger from '../../utils/logger.js';
import { LocalEmbeddingProvider } from './local.js';
import { GeminiEmbeddingProvider } from './gemini.js';
import { MiniLMEmbeddingProvider } from './minilm.js';

const cache = new Map();

/**
 * Resolve an embedding provider by name. Falls back to `local` if a cloud
 * provider is requested without credentials — the pipeline keeps working.
 */
export function getEmbeddingProvider(name = config.embeddingProvider) {
  if (cache.has(name)) return cache.get(name);

  let provider;
  try {
    switch (name) {
      case 'gemini':
        provider = new GeminiEmbeddingProvider({
          apiKey: config.gemini.apiKey,
          model: config.gemini.embeddingModel,
        });
        break;
      case 'minilm':
        provider = new MiniLMEmbeddingProvider();
        break;
      case 'local':
      default:
        provider = new LocalEmbeddingProvider(config.embeddingDim);
    }
  } catch (err) {
    logger.warn(`embedding provider "${name}" unavailable (${err.message}); using local`);
    provider = new LocalEmbeddingProvider(config.embeddingDim);
  }

  cache.set(name, provider);
  return provider;
}

export default getEmbeddingProvider;
