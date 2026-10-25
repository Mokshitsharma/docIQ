import Document from '../../models/Document.js';
import Workspace from '../../models/Workspace.js';
import QueryLog from '../../models/QueryLog.js';
import { retrieve } from '../retrieval/retriever.js';
import { getLLMProvider } from '../llm/index.js';

export const SYSTEM_PROMPT = `You are DocIQ, a document-grounded assistant.
Rules:
- Answer ONLY using the numbered context passages provided.
- Cite the passages you used inline with bracketed numbers, e.g. [1], [2].
- If the answer is not contained in the context, reply exactly:
  "I couldn't find this in the provided documents."
- Be concise and precise. Quote figures, dates and defined terms verbatim.`;

/**
 * Answer a natural-language question against a workspace's documents.
 * Retrieves top-k chunks, grounds an LLM answer, maps [n] citations back to
 * chunk/document/page, applies the confidence threshold, and logs the query.
 */
export async function answerQuestion({ workspaceId, question, userId } = {}) {
  const started = Date.now();
  const workspace = await Workspace.findById(workspaceId).lean();
  if (!workspace) throw Object.assign(new Error('Workspace not found'), { status: 404 });

  const s = workspace.settings || {};
  const chunks = await retrieve(question, {
    workspaceId,
    topK: s.topK,
    strategy: s.retrievalStrategy,
    embeddingProvider: s.embeddingProvider,
  });

  const docIds = [...new Set(chunks.map((c) => String(c.documentId)))];
  const docs = docIds.length
    ? await Document.find({ _id: { $in: docIds } }).select('filename').lean()
    : [];
  const docNames = new Map(docs.map((d) => [String(d._id), d.filename]));

  const llm = getLLMProvider(s.llmProvider);
  const out = await generateGroundedAnswer({
    question,
    chunks,
    llm,
    threshold: s.confidenceThreshold ?? 0.15,
    docNameOf: (c) => docNames.get(String(c.documentId)) || 'doc',
  });

  const result = {
    answer: out.answer,
    grounded: out.grounded,
    confidence: out.confidence,
    citations: out.citations.map((ct) => ({
      marker: ct.marker,
      chunkId: String(ct.chunk._id),
      documentId: String(ct.chunk.documentId),
      filename: ct.filename,
      pageNumber: ct.chunk.pageNumber,
      score: ct.chunk.score,
      excerpt: ct.chunk.text.length > 400 ? ct.chunk.text.slice(0, 400) + '…' : ct.chunk.text,
    })),
    retrieved: chunks.map(toRetrievedMeta),
    llmProvider: out.gated ? s.llmProvider || 'extractive' : llm.name,
  };
  await logQuery({ workspaceId, userId, question, result, started });
  return result;
}

export const REFUSAL = "I couldn't find this in the provided documents.";

/**
 * Pure grounding step shared by the API and the offline eval (no DB access).
 *
 * chunks: ranked `{ text, pageNumber, score }[]`. If the top score is below
 * `threshold` (or there are no chunks) the answer is a refusal without calling
 * the LLM (`gated: true`). Otherwise the LLM answers from numbered context and
 * its [n] markers are mapped back to chunks (all retrieved chunks if none cited).
 */
export async function generateGroundedAnswer({ question, chunks, llm, threshold = 0.15, docNameOf = () => 'doc' }) {
  const topScore = chunks[0]?.score ?? 0;
  const confidence = Number(topScore.toFixed(4));

  // Not enough signal → refuse rather than hallucinate.
  if (chunks.length === 0 || topScore < threshold) {
    return { answer: REFUSAL, grounded: false, confidence, citations: [], gated: true };
  }

  const context = chunks
    .map((c, i) => `[${i + 1}] (${docNameOf(c)} p.${c.pageNumber}) ${c.text}`)
    .join('\n\n');

  const prompt = `Question: ${question}\n\nContext:\n${context}\n\nAnswer (with [n] citations):`;
  const answer = (await llm.complete({ system: SYSTEM_PROMPT, prompt, temperature: 0.1, maxTokens: 800 })).trim();

  // Map cited [n] back to real chunks.
  const citedNums = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
    .filter((n) => n >= 1 && n <= chunks.length);
  const citeSource = citedNums.length ? citedNums : chunks.map((_, i) => i + 1); // fall back to all retrieved

  const grounded = !/couldn'?t find this in the provided documents/i.test(answer);
  return {
    answer,
    grounded,
    confidence,
    citations: citeSource.map((n) => ({ marker: n, chunk: chunks[n - 1], filename: docNameOf(chunks[n - 1]) })),
    gated: false,
  };
}

function toRetrievedMeta(c) {
  return {
    chunkId: String(c._id),
    documentId: String(c.documentId),
    pageNumber: c.pageNumber,
    score: c.score,
  };
}

async function logQuery({ workspaceId, userId, question, result, started }) {
  try {
    await QueryLog.create({
      workspaceId,
      userId: userId || undefined,
      question,
      answer: result.answer,
      grounded: result.grounded,
      confidence: result.confidence,
      citedChunkIds: result.citations.map((c) => c.chunkId),
      citations: result.citations,
      llmProvider: result.llmProvider,
      latencyMs: Date.now() - started,
    });
  } catch {
    /* logging is best-effort */
  }
}

export default answerQuestion;
