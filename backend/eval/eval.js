/**
 * Standalone retrieval + grounding eval. No MongoDB / Redis required.
 *
 *   npm run eval
 *
 * Ingests eval/fixtures/<doc> through the real parser + chunker + embedder into
 * an in-memory vector store, then runs eval/sample-qa.json:
 *   - retrieval hit-rate: does a top-k chunk contain the expected answer text?
 *   - refusal accuracy:    are unanswerable questions correctly refused?
 *
 * Run it after any change to chunking / retrieval and eyeball the misses.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, detectFileType } from '../src/services/ingestion/parser.js';
import { chunkPages } from '../src/services/ingestion/chunker.js';
import { getEmbeddingProvider } from '../src/services/embedding/index.js';
import { getLLMProvider } from '../src/services/llm/index.js';
import { MemoryVectorStore } from '../src/services/retrieval/vectorStore.js';
import config from '../src/config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STOP = new Set(
  ('the a an and or of to for in on at is are was were be by with as it its this that what which ' +
    'how when where who whom does do did will would should could can may might must have has had').split(
    ' '
  )
);

function contentTerms(question) {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function kwScore(question, text) {
  const q = new Set(contentTerms(question));
  const body = text.toLowerCase();
  let hit = 0;
  for (const t of q) if (body.includes(t)) hit++;
  return q.size ? hit / q.size : 0;
}

async function main() {
  const spec = JSON.parse(await fs.readFile(path.join(__dirname, 'sample-qa.json'), 'utf8'));
  const docPath = path.join(__dirname, spec.document);
  const fileType = detectFileType(docPath);

  console.log(`\nDocIQ eval`);
  console.log(`  doc:   ${spec.document}`);
  console.log(`  llm:   ${config.llmProvider}   embed: ${config.embeddingProvider}`);
  console.log('  ' + '─'.repeat(60));

  // Ingest
  // Smaller chunks than the app default so retrieval has to actually
  // discriminate between clauses (the fixture is short).
  const chunkSize = Number(process.env.EVAL_CHUNK_SIZE) || 120;
  const chunkOverlap = Number(process.env.EVAL_CHUNK_OVERLAP) || 30;

  const { pages } = await parseDocument(docPath, fileType);
  const chunks = chunkPages(pages, { chunkSize, chunkOverlap });
  const embedder = getEmbeddingProvider();
  const vectors = await embedder.embed(chunks.map((c) => c.text));
  const store = new MemoryVectorStore();
  await store.upsert(
    chunks.map((c, i) => ({
      id: String(i),
      vector: vectors[i],
      metadata: { ...c, idx: i },
    }))
  );
  console.log(`  ingested ${chunks.length} chunks (size≈${chunkSize}tok) from ${pages.length} page(s)\n`);

  const llm = getLLMProvider();
  const topK = config.defaults.topK;

  let retrievalHits = 0;
  let answerable = 0;
  let refusalCorrect = 0;
  let refusalTotal = 0;

  for (const [n, c] of spec.cases.entries()) {
    const [qVec] = await embedder.embed([c.question]);
    const hits = await store.query(qVec, { topK });
    const retrieved = hits.map((h) => h.metadata);
    const joined = retrieved.map((r) => r.text).join('\n');

    const label = `${String(n + 1).padStart(2, ' ')}. ${c.question}`;

    if (c.expectAnswerable) {
      answerable++;
      const found = c.expectedKeywords.some((k) => joined.toLowerCase().includes(k.toLowerCase()));
      if (found) retrievalHits++;
      const pages = [...new Set(retrieved.map((r) => 'p.' + r.pageNumber))].join(',');
      console.log(`${found ? 'PASS' : 'MISS'}  ${label}`);
      console.log(
        `       expected≈[${c.expectedKeywords.join(' | ')}]  retrieved ${pages}  topScore=${hits[0]?.score.toFixed(3)}`
      );
    } else {
      refusalTotal++;
      // Refusal heuristic: best keyword overlap across retrieved chunks is weak.
      const best = Math.max(0, ...retrieved.map((r) => kwScore(c.question, r.text)));
      const refused = best < 0.5;
      if (refused) refusalCorrect++;
      console.log(`${refused ? 'PASS' : 'MISS'}  ${label}   (expected: refuse; bestOverlap=${best.toFixed(2)})`);
    }
  }

  // One end-to-end grounded answer as a smoke check.
  const demo = spec.cases[0];
  const [dVec] = await embedder.embed([demo.question]);
  const dHits = await store.query(dVec, { topK });
  const ctx = dHits
    .map((h, i) => `[${i + 1}] (p.${h.metadata.pageNumber}) ${h.metadata.text}`)
    .join('\n\n');
  const answer = await llm.complete({
    system: 'Answer only from the context. Cite [n]. If absent, say you could not find it.',
    prompt: `Question: ${demo.question}\n\nContext:\n${ctx}\n\nAnswer:`,
    temperature: 0,
  });

  console.log('\n  ' + '─'.repeat(60));
  console.log(`  retrieval hit-rate : ${retrievalHits}/${answerable}`);
  console.log(`  refusal accuracy   : ${refusalCorrect}/${refusalTotal}`);
  console.log(`\n  sample answer for "${demo.question}":`);
  console.log('  ' + answer.replace(/\n/g, '\n  '));
  console.log('');

  const pass = retrievalHits / Math.max(answerable, 1) >= 0.7 && refusalCorrect === refusalTotal;
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
