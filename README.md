# DocIQ — AI Document Intelligence Platform

Turn unstructured documents (contracts, invoices, compliance docs) into a
queryable, source-cited knowledge base.

This repo implements the MVP described in
[`rag-document-intelligence-spec.md`](./rag-document-intelligence-spec.md):
upload → ingest (parse / chunk / embed) → ask → grounded answer with citations,
plus automatic risk/clause extraction, per-workspace dynamic config, and query
history.

## Layout

```
docIQ/
├── backend/     Node.js + Express + MongoDB + (optional) BullMQ/Redis
├── frontend/    Next.js (App Router) + Tailwind — upload UI, chat, source viewer
├── docker-compose.yml   MongoDB + Redis + Chroma for local dev
└── rag-document-intelligence-spec.md
```

## Quick start

```bash
# 1. Infra (Mongo + Redis + Chroma). Optional — see "Running without Docker".
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env          # fill in GEMINI_API_KEY / GROQ_API_KEY if you have them
npm install
npm run dev                   # http://localhost:4000

# 3. Frontend (separate terminal)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

### Running without Docker / API keys

The backend degrades gracefully so you can demo it offline:

| Dependency | Missing → fallback |
|---|---|
| Redis / BullMQ | `USE_QUEUE=false` → documents are processed synchronously on upload |
| Chroma | `VECTOR_STORE=memory` → in-process cosine-similarity index |
| Gemini / Groq key | `LLM_PROVIDER=extractive` → answers are stitched from retrieved chunks |
| Gemini embeddings | `EMBEDDING_PROVIDER=local` → deterministic hashed bag-of-words vectors |

MongoDB is the one hard requirement — use `docker compose up -d mongo` or a free
Atlas cluster.

### Demo data

`npm run dev:mem` (backend, no MongoDB needed) boots an ephemeral in-memory
MongoDB **and seeds a "Demo — Sample MSA" workspace** with the sample contract
already ingested, so the UI has something to query on first load. Set
`SEED_DEMO=true` to get the same seed with `npm run dev` against a real MongoDB
(idempotent — it no-ops if the demo doc is already ingested).

The chat panel always shows six recommended clause-focused questions above the
input; click one to ask it.

## Design principle: dynamic / admin-configurable

Every tunable lives in `workspace.settings` and is editable at runtime via
`PATCH /api/workspaces/:id/settings` — no redeploy needed:

`chunkSize`, `chunkOverlap`, `topK`, `llmProvider`, `embeddingProvider`,
`retrievalStrategy` (`vector` | `hybrid`), `confidenceThreshold`.

`embeddingProvider` accepts `local` (default), `minilm` (free local
all-MiniLM-L6-v2; needs the dev dependency `@huggingface/transformers`) or `gemini`.

## Tests & verification

```bash
cd backend
npm test            # unit tests: chunker, BM25, ranking, grounding, eval dataset + reproducibility
npm run eval        # retrieval + answer eval on public documents (no Mongo / API key needed)
npm run eval:check  # re-run the eval and fail if it differs from the committed results JSON
npm run verify:e2e  # full HTTP flow against an in-memory MongoDB (no Mongo/Docker needed)
```

`npm run verify:e2e` boots the real Express app against `mongodb-memory-server` and
drives the whole product path over HTTP: create workspace → tune settings → upload →
poll ingestion → risk summary → grounded query → out-of-scope query (must refuse) →
switch to hybrid retrieval → re-query → query history. Last run: **16/16 checks pass**
(on the project's own synthetic sample MSA, `eval/fixtures/sample-msa.txt`).

## Evaluation

Every number below is copied from
[`backend/eval/results/public-docs-qa.json`](./backend/eval/results/public-docs-qa.json),
which `npm run eval` regenerates (`npm run eval:check` verifies it is reproduced
exactly; `npm test` re-checks the BM25 and local-embedder rows).

**Data.** 71 hand-written questions (58 answerable, 13 unanswerable) over 5 public
documents, all works of the U.S. Government and public domain in the U.S.
(17 U.S.C. § 105). Text snapshots are in `backend/eval/corpus/` and their source
URLs, retrieval date and SHA-256 are in
[`SOURCES.json`](./backend/eval/corpus/SOURCES.json); `node eval/fetch-corpus.js`
re-downloads them.

| Document | Type | Source | Questions |
|---|---|---|---|
| FAR 52.212-4 Contract Terms and Conditions—Commercial Products and Services | contract | [eCFR 48 CFR 52.212-4](https://www.ecfr.gov/current/title-48/section-52.212-4) | 15 |
| FAR 52.232-25 Prompt Payment | contract | [eCFR 48 CFR 52.232-25](https://www.ecfr.gov/current/title-48/section-52.232-25) | 10 |
| HIPAA Breach Notification Rule (45 CFR 164 Subpart D) | policy | [eCFR 45 CFR 164 Subpart D](https://www.ecfr.gov/current/title-45/part-164/subpart-D) | 11 |
| Standards of Ethical Conduct — Gifts From Outside Sources (5 CFR 2635 Subpart B) | policy | [eCFR 5 CFR 2635 Subpart B](https://www.ecfr.gov/current/title-5/part-2635/subpart-B) | 11 |
| NIST Cybersecurity Framework 2.0 (CSWP 29) | report | [nvlpubs.nist.gov](https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf) | 11 |

**Setup.** All 5 documents in one index, app-default chunking (800 tokens,
100 overlap → 79 chunks), top-k = 5. A retrieved chunk counts as relevant if it
comes from the gold document and contains the question's verbatim evidence span.
Answers come from the **extractive (no-LLM) provider**, since no LLM API key is
configured. An answer counts as correct if it is not a refusal and contains a
gold answer string. For an unanswerable question, the correct output is a refusal.
The intervals are 95% percentile-bootstrap CIs (10,000 resamples, seed 1234).

Retrievers:
- `bm25`: Okapi BM25 over all chunks.
- `vector`: cosine similarity (app strategy `vector`).
- `hybrid`: the app's `hybrid` strategy (vector top-20, re-scored 0.7·vector + 0.3·BM25-lite).
- `hybrid-rrf`: reciprocal-rank fusion of BM25 and vector (eval-only, not wired into the API).

Embedders:
- `local`: the app's default hashed bag-of-words embedding (lexical, not semantic).
- `minilm`: all-MiniLM-L6-v2, run locally.

| Retriever | Embedder | hit@1 | hit@3 | hit@5 | MRR@5 | Answer acc. (n=58) | Refusal acc. (n=13) | Overall acc. (n=71) |
|---|---|---|---|---|---|---|---|---|
| bm25 | — | 79.3 [69.0–89.7] | 94.8 [87.9–100.0] | 98.3 [94.8–100.0] | 0.879 | 70.7 [58.6–81.0] | 15.4 [0.0–38.5] | 60.6 [49.3–71.8] |
| vector | local | 55.2 [43.1–69.0] | 77.6 [67.2–87.9] | 86.2 [77.6–94.8] | 0.672 | 65.5 [53.4–77.6] | 15.4 [0.0–38.5] | 56.3 [45.1–67.6] |
| hybrid | local | 74.1 [62.1–84.5] | 91.4 [84.5–98.3] | 93.1 [86.2–98.3] | 0.826 | 72.4 [60.3–82.8] | 15.4 [0.0–38.5] | 62.0 [50.7–73.2] |
| hybrid-rrf | local | 63.8 [51.7–75.9] | 87.9 [79.3–94.8] | 94.8 [87.9–100.0] | 0.770 | 69.0 [56.9–81.0] | 15.4 [0.0–38.5] | 59.2 [47.9–70.4] |
| vector | minilm | 53.4 [41.4–67.2] | 77.6 [67.2–87.9] | 93.1 [86.2–98.3] | 0.674 | 67.2 [55.2–79.3] | 15.4 [0.0–38.5] | 57.8 [46.5–69.0] |
| hybrid | minilm | 74.1 [62.1–84.5] | 94.8 [87.9–100.0] | 96.5 [91.4–100.0] | 0.843 | 70.7 [58.6–81.0] | 15.4 [0.0–38.5] | 60.6 [49.3–71.8] |
| hybrid-rrf | minilm | 69.0 [56.9–81.0] | 93.1 [86.2–98.3] | 96.5 [91.4–100.0] | 0.807 | 69.0 [56.9–81.0] | 15.4 [0.0–38.5] | 59.2 [47.9–70.4] |

Paired bootstrap differences (same questions, a − b, percentage points):

| a − b | hit@5 Δ [95% CI] | overall acc. Δ [95% CI] |
|---|---|---|
| hybrid:local − vector:local | +6.9 [0.0, 15.5] | +5.6 [−1.4, 12.7] |
| hybrid:local − bm25 | −5.2 [−12.1, 0.0] | +1.4 [−2.8, 5.6] |
| hybrid:minilm − vector:minilm | +3.5 [−3.5, 10.3] | +2.8 [0.0, 7.0] |
| hybrid:minilm − bm25 | −1.7 [−6.9, 3.5] | 0.0 [0.0, 0.0] |
| hybrid-rrf:local − vector:local | +8.6 [1.7, 15.5] | +2.8 [−2.8, 8.5] |
| hybrid-rrf:minilm − vector:minilm | +3.5 [0.0, 8.6] | +1.4 [0.0, 4.2] |

**What this shows:**
- Hybrid ranks better than vector-only (hit@1 74.1 vs 55.2 with `local`, 74.1 vs 53.4 with `minilm`).
- On this corpus, plain BM25 has the best retrieval scores (hit@1 79.3, hit@5 98.3).
  Hybrid does not beat it, and most hybrid-vs-BM25 CIs include 0.
  The questions are mostly exact-term lookups in legal/regulatory text, which favours keyword retrieval.
- Only one paired CI excludes zero: hybrid-rrf:local vs vector:local on hit@5.
- **Without the coverage gate, refusal is weak: 2 of 13 unanswerable questions refused (15.4%) in every configuration.**
  The 0.15 confidence gate never fires. The `vector`/`hybrid` scores are (cos+1)/2; the lowest top-1 score on any of the 71 questions is 0.5994 (`vector:local`) and 0.6387 (`vector:minilm`), so `refusedByGate` is 0 in every gated run (see `runs[].gate` in the JSON).
  The extractive provider's term-overlap check usually finds a related sentence and answers.
- Answer accuracy (65.5–72.4%) is well below hit@5 (86.2–98.3%).
  The extractive provider often picks a sentence from the right chunk that is not the one with the answer.

### Refusal gate: query-term coverage

The answer step now also refuses when the best top-5 chunk covers less than
`minQueryCoverage` of the question's terms, weighted by idf over the retrieved chunks
(`src/services/query/coverage.js`). The threshold, **0.30**, was chosen only on a separate
24-question dev split (`eval/datasets/dev-qa.json`: 14 answerable, 10 unanswerable; none of
them are test questions). `node eval/tune-gate.js` picks the value with the best mean dev
overall accuracy and writes `eval/results/gate-tuning.json`. It is now the app default
(`DEFAULT_MIN_QUERY_COVERAGE`). Test-set results with the gate, same retrieval as above:

| Retriever | Embedder | Answer acc. (n=58) | Refusal acc. (n=13) | Overall acc. (n=71) | Overall Δ vs no gate [95% CI] |
|---|---|---|---|---|---|
| bm25 | — | 63.8 [51.7–75.9] | 76.9 [53.8–100.0] | 66.2 [54.9–77.5] | +5.6 [−2.8, 15.5] |
| vector | local | 62.1 [50.0–74.1] | 69.2 [46.2–92.3] | 63.4 [52.1–74.7] | +7.0 [−1.4, 15.5] |
| hybrid | local | 65.5 [53.4–77.6] | 76.9 [53.8–100.0] | 67.6 [56.3–78.9] | +5.6 [−2.8, 15.5] |
| hybrid-rrf | local | 62.1 [50.0–74.1] | 76.9 [53.8–100.0] | 64.8 [53.5–76.1] | +5.6 [−4.2, 15.5] |
| vector | minilm | 62.1 [50.0–74.1] | 69.2 [46.2–92.3] | 63.4 [52.1–74.7] | +5.6 [−2.8, 14.1] |
| hybrid | minilm | 65.5 [53.4–77.6] | 69.2 [46.2–92.3] | 66.2 [54.9–77.5] | +5.6 [−2.8, 14.1] |
| hybrid-rrf | minilm | 62.1 [50.0–74.1] | 76.9 [53.8–100.0] | 64.8 [53.5–76.1] | +5.6 [−2.8, 15.5] |

**The trade-off:**
- Refusal accuracy rises from 15.4% to 69.2–76.9%, i.e. 9–10 of 13 refused.
- Answer accuracy on answerable questions falls by 3.4–6.9 points (e.g. hybrid:local 72.4 → 65.5),
  because some correct answers are now wrongly refused.
- Overall accuracy rises by 5.6–7.0 points, but every paired CI includes 0.
  With 13 unanswerable questions, the improvement is not statistically established.

## Limitations

- **No LLM was evaluated.** No Gemini/Groq/OpenAI key is configured, so every answer number above is for
  the extractive fallback. `npm run eval -- --llm groq` (or `gemini`/`openai`) runs the same eval with an
  LLM once a key is in `backend/.env`. Those numbers have not been produced. LLM output is not
  deterministic, so `eval:check` would not apply to them.
- **Small, single-author dataset.** 71 questions, written by the developer, with evidence spans chosen
  from the documents. The CIs are wide (e.g. refusal accuracy rests on 13 questions), and the
  questions may lean towards the vocabulary of the source text, which favours lexical retrieval.
- **Lenient answer scoring.** A substring match on a short gold string can count an answer as correct
  when it quotes the right figure from the wrong sentence. It can also count a correct paraphrase as wrong.
- **The default `local` embedder is lexical** (hashed bag-of-words). "Vector" with `local` is not a
  semantic baseline; the `minilm` rows are the semantic comparison.
- **Little tuning, and a small dev split.** The hybrid weights (0.7/0.3), the 0.15 confidence threshold
  and the chunk size are app defaults that were never tuned. The only tuned value is the 0.30 coverage
  threshold. It was chosen on a 24-question dev split from the same 5 documents and the same author, so
  it may not transfer to other corpora. Its dev accuracy (mean 0.875) is higher than on the test set.
  0.30, 0.35 and 0.40 tied on dev, and the lowest was taken.
- **The PDF page numbers are wrong.** The PDF parser splits pages on form feeds, but `pdf-parse` 1.1.1
  does not emit them, so all of a PDF's text is attributed to page 1. The eval uses text snapshots and
  does not measure page-level citation accuracy.
- **Not exercised by any test or eval:** Chroma vector store, BullMQ/Redis queue, Gemini embeddings and the
  LLM providers. `verify:e2e` uses an in-memory MongoDB (`mongodb-memory-server`); this machine has
  no local MongoDB or Docker.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/workspaces` | create workspace |
| GET | `/api/workspaces/:id` | get workspace + settings |
| PATCH | `/api/workspaces/:id/settings` | update dynamic config |
| POST | `/api/documents/upload` | upload (multipart `file`, `workspaceId`) + queue |
| GET | `/api/documents/:id/status` | ingestion status |
| GET | `/api/documents/:id/risks` | auto-extracted clause summary |
| POST | `/api/query` | `{ workspaceId, question }` → answer + citations |
| GET | `/api/workspaces/:id/history` | query log |
