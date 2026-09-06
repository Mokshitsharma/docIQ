import Document from '../../models/Document.js';
import Workspace from '../../models/Workspace.js';
import QueryLog from '../../models/QueryLog.js';
import { retrieve } from '../retrieval/retriever.js';
import { getLLMProvider } from '../llm/index.js';

const SYSTEM_PROMPT = `You are DocIQ, a document-grounded assistant.
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

  const topScore = chunks[0]?.score ?? 0;
  const threshold = s.confidenceThreshold ?? 0.15;

  // Not enough signal → refuse rather than hallucinate.
  if (chunks.length === 0 || topScore < threshold) {
    const result = {
      answer: "I couldn't find this in the provided documents.",
      grounded: false,
      confidence: Number(topScore.toFixed(4)),
      citations: [],
      retrieved: chunks.map(toRetrievedMeta),
      llmProvider: s.llmProvider || 'extractive',
    };
    await logQuery({ workspaceId, userId, question, result, started });
    return result;
  }

  const docIds = [...new Set(chunks.map((c) => String(c.documentId)))];
  const docs = await Document.find({ _id: { $in: docIds } }).select('filename').lean();
  const docNames = new Map(docs.map((d) => [String(d._id), d.filename]));

  const context = chunks
    .map(
      (c, i) =>
        `[${i + 1}] (${docNames.get(String(c.documentId)) || 'doc'} p.${c.pageNumber}) ${c.text}`
    )
    .join('\n\n');

  const llm = getLLMProvider(s.llmProvider);
  const prompt = `Question: ${question}\n\nContext:\n${context}\n\nAnswer (with [n] citations):`;
  const answer = (await llm.complete({ system: SYSTEM_PROMPT, prompt, temperature: 0.1, maxTokens: 800 })).trim();

  // Map cited [n] back to real chunks.
  const citedNums = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
    .filter((n) => n >= 1 && n <= chunks.length);
  const citeSource = citedNums.length ? citedNums : chunks.map((_, i) => i + 1); // fall back to all retrieved

  const citations = citeSource.map((n) => {
    const c = chunks[n - 1];
    return {
      marker: n,
      chunkId: String(c._id),
      documentId: String(c.documentId),
      filename: docNames.get(String(c.documentId)) || 'doc',
      pageNumber: c.pageNumber,
      score: c.score,
      excerpt: c.text.length > 400 ? c.text.slice(0, 400) + '…' : c.text,
    };
  });

  const grounded = !/couldn'?t find this in the provided documents/i.test(answer);
  const result = {
    answer,
    grounded,
    confidence: Number(topScore.toFixed(4)),
    citations,
    retrieved: chunks.map(toRetrievedMeta),
    llmProvider: llm.name,
  };
  await logQuery({ workspaceId, userId, question, result, started });
  return result;
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
