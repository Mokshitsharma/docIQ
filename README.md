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

## Tests & verification

```bash
cd backend
npm test            # unit tests (chunker invariants)
npm run eval        # retrieval + refusal eval on eval/sample-qa.json (no Mongo needed)
npm run verify:e2e  # full HTTP flow against an in-memory MongoDB (no Mongo/Docker needed)
```

`npm run verify:e2e` boots the real Express app against `mongodb-memory-server` and
drives the whole product path over HTTP: create workspace → tune settings → upload →
poll ingestion → risk summary → grounded query → out-of-scope query (must refuse) →
switch to hybrid retrieval → re-query → query history. Last run: **16/16 checks pass**.

> Limitation: this machine has no local MongoDB or Docker, so the end-to-end pass
> uses an ephemeral in-memory MongoDB binary (downloaded once by
> `mongodb-memory-server`). Against a real MongoDB / Atlas the same script and
> endpoints apply unchanged.

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
