import Document from '../../models/Document.js';
import Chunk from '../../models/Chunk.js';
import Workspace from '../../models/Workspace.js';
import logger from '../../utils/logger.js';
import { parseDocument } from './parser.js';
import { chunkPages } from './chunker.js';
import { getEmbeddingProvider } from '../embedding/index.js';
import { getVectorStore } from '../retrieval/vectorStore.js';
import { extractRisks } from '../risk/extractor.js';
import { getStorage } from '../storage/index.js';
import { withEmbeddingCache } from '../cache/index.js';

/**
 * Full ingestion pipeline for one document:
 *   parse → chunk → embed → upsert to vector store → persist chunks → risks
 *
 * Idempotent: re-ingesting a document clears its previous chunks/vectors first.
 * Designed to be callable from a BullMQ worker or synchronously.
 */
export async function ingestDocument(documentId) {
  const doc = await Document.findById(documentId);
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const workspace = await Workspace.findById(doc.workspaceId).lean();
  const settings = workspace?.settings || {};

  try {
    await Document.updateOne({ _id: doc._id }, { status: 'processing', error: null });

    // 1. Parse
    const { pages, pageCount, ocrUsed } = await parseDocument(await getStorage().get(doc.storedPath), doc.fileType);
    const totalText = pages.reduce((n, p) => n + p.text.length, 0);
    if (totalText === 0) throw new Error('No extractable text (scanned PDF? OCR not enabled in MVP)');

    // 2. Chunk
    const chunks = chunkPages(pages, {
      chunkSize: settings.chunkSize,
      chunkOverlap: settings.chunkOverlap,
    });
    if (chunks.length === 0) throw new Error('Chunking produced 0 chunks');

    // 3. Embed
    const embedder = withEmbeddingCache(getEmbeddingProvider(settings.embeddingProvider));
    const vectors = await embedder.embed(chunks.map((c) => c.text));

    // 4. Clear any previous ingestion of this doc, then persist chunks
    const store = getVectorStore();
    await store.deleteByFilter({ documentId: String(doc._id) });
    await Chunk.deleteMany({ documentId: doc._id });

    const chunkDocs = await Chunk.insertMany(
      chunks.map((c, i) => ({
        documentId: doc._id,
        workspaceId: doc.workspaceId,
        ordinal: c.ordinal,
        text: c.text,
        pageNumber: c.pageNumber,
        tokenCount: c.tokenCount,
        embeddingId: `${doc._id}:${c.ordinal}`,
        embedding: vectors[i],
        metadata: { embeddingProvider: embedder.name },
      }))
    );

    // 5. Upsert vectors
    await store.upsert(
      chunkDocs.map((cd, i) => ({
        id: cd.embeddingId,
        vector: vectors[i],
        metadata: {
          chunkId: String(cd._id),
          documentId: String(doc._id),
          workspaceId: String(doc.workspaceId),
          pageNumber: cd.pageNumber,
          text: cd.text.slice(0, 1000),
        },
      }))
    );

    // 6. Risk / clause auto-extraction
    let risks = null;
    try {
      risks = await extractRisks(
        chunkDocs.map((c) => ({ text: c.text, pageNumber: c.pageNumber })),
        settings.llmProvider
      );
    } catch (err) {
      logger.warn(`risk extraction failed for ${doc._id}: ${err.message}`);
    }

    await Document.updateOne(
      { _id: doc._id },
      {
        status: 'ready',
        pageCount,
        ocrUsed,
        chunkCount: chunkDocs.length,
        risks,
        error: null,
      }
    );
    await Workspace.updateOne({ _id: doc.workspaceId }, { $inc: { contentVersion: 1 } }); // invalidate cached answers

    logger.info(`Ingested ${doc.filename}: ${chunkDocs.length} chunks, ${pageCount} pages`);
    return { chunkCount: chunkDocs.length, pageCount };
  } catch (err) {
    logger.error(`Ingestion failed for ${doc._id}: ${err.message}`);
    await Document.updateOne({ _id: doc._id }, { status: 'failed', error: err.message });
    throw err;
  }
}

/** Remove a document and everything derived from it. */
export async function deleteDocument(documentId) {
  const doc = await Document.findById(documentId);
  if (!doc) return;
  await getVectorStore().deleteByFilter({ documentId: String(doc._id) });
  await Chunk.deleteMany({ documentId: doc._id });
  await getStorage().remove(doc.storedPath).catch(() => {});
  await Document.deleteOne({ _id: doc._id });
}

export default ingestDocument;
