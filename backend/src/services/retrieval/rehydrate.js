import Chunk from '../../models/Chunk.js';
import logger from '../../utils/logger.js';
import { getEmbeddingProvider } from '../embedding/index.js';
import { getVectorStore } from './vectorStore.js';

/**
 * The in-memory vector store starts empty on every boot, while chunks persist in Mongo.
 * Reload it from the stored chunk embeddings (re-embedding chunks saved before the
 * embedding field existed) so queries keep working after a restart.
 */
export async function rehydrateVectorStore({ batchSize = 500 } = {}) {
  const store = getVectorStore();
  let loaded = 0;
  let reembedded = 0;
  let batch = [];

  const flush = async () => {
    const missing = batch.filter((c) => !c.embedding?.length);
    for (const c of missing) {
      const [vec] = await getEmbeddingProvider(c.metadata?.embeddingProvider).embed([c.text]);
      c.embedding = vec;
      await Chunk.updateOne({ _id: c._id }, { embedding: vec });
      reembedded++;
    }
    await store.upsert(
      batch.map((c) => ({
        id: c.embeddingId,
        vector: c.embedding,
        metadata: {
          chunkId: String(c._id),
          documentId: String(c.documentId),
          workspaceId: String(c.workspaceId),
          pageNumber: c.pageNumber,
          text: c.text.slice(0, 1000),
        },
      }))
    );
    loaded += batch.length;
    batch = [];
  };

  for await (const c of Chunk.find({ embeddingId: { $exists: true } }).select('+embedding').lean().cursor()) {
    batch.push(c);
    if (batch.length >= batchSize) await flush();
  }
  if (batch.length) await flush();
  logger.info(`vector store rehydrated: ${loaded} chunks (${reembedded} re-embedded)`);
  return { loaded, reembedded };
}
