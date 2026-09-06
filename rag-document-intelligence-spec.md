# DocIQ — AI Document Intelligence Platform
### Technical Specification & Build Document (for Claude Code)

---

## 1. Overview

DocIQ is a B2B SaaS tool that lets teams (law firms, accounting firms, SMB compliance/ops teams) upload contracts, invoices, and compliance documents, then ask natural-language questions, extract clauses, and flag risks — instead of manually reading hundreds of pages.

**Core value prop:** Turn unstructured documents into a queryable knowledge base with source-cited answers, in minutes.

**Differentiation from Mokshit's existing projects:** All prior projects (churn prediction, sales prediction, inventory management) are structured/tabular ML. DocIQ is unstructured text reasoning — a different problem class entirely (retrieval, embeddings, semantic search, LLM grounding).

---

## 2. Goals & Success Metrics

| Goal | Metric |
|---|---|
| Fast, accurate document Q&A | >90% of answers correctly cite the source clause/page |
| Low hallucination | Answers refuse to answer when not grounded in retrieved context |
| Usable by non-technical users | Upload → ask → answer, no config required for MVP |
| Multi-document support | User can query across an entire folder/workspace, not just one file |

---

## 3. System Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│  Frontend   │─────▶│   Backend    │─────▶│  Vector DB       │
│ (Next.js/   │      │  (Node.js/   │      │  (Chroma/Qdrant) │
│  React)     │◀─────│  Express)    │◀─────│                  │
└─────────────┘      └──────┬───────┘      └─────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
      ┌───────────┐  ┌──────────────┐  ┌──────────┐
      │ Document  │  │  Embedding   │  │   LLM    │
      │ Parser    │  │  Service     │  │ (Gemini/ │
      │ (pdf-parse,│  │(sentence-    │  │  Groq)   │
      │ mammoth,   │  │ transformers │  │          │
      │ tesseract  │  │  or Gemini   │  │          │
      │ for OCR)   │  │  embeddings) │  │          │
      └───────────┘  └──────────────┘  └──────────┘
```

### Design principle — Dynamic / Admin-Configurable (carry over from Movigo pattern)
Everything that could change per-client or per-workspace must be config-driven, not hardcoded:
- Chunk size, chunk overlap → configurable per workspace (defaults: 800 tokens, 100 overlap)
- Which LLM provider is used (Gemini / Groq / OpenAI-compatible) → swappable via env/config, not hardcoded imports
- Retrieval strategy (pure vector vs hybrid vector+keyword) → toggle per workspace
- Number of retrieved chunks (top-k) → configurable, default 5
- Answer confidence threshold (below which it says "not found in documents") → configurable
- All of this lives in a `workspace_settings` table/collection, editable via an admin panel — no redeploys needed to tune behavior for a client.

---

## 4. Tech Stack (free-tier first)

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express | Matches existing stack, fast to ship |
| Frontend | Next.js (React) + Tailwind | Fast dev, good for a dashboard-style product |
| Vector DB | Chroma (self-hosted, free) or Qdrant Cloud free tier | No cost at MVP scale |
| Embeddings | `sentence-transformers` (all-MiniLM-L6-v2, free/local) OR Gemini embedding API (free tier) | Avoid per-embedding cost early on |
| LLM | Gemini 1.5 Flash (free tier) or Groq (Llama 3.1, free/fast) | Free tier generous, fast inference |
| Document parsing | `pdf-parse`, `mammoth` (docx), `tesseract.js` (OCR for scanned docs) | All open-source |
| Database (metadata) | MongoDB (matches existing stack) | Store docs, chunks metadata, users, workspaces |
| Auth | JWT + bcrypt (self-rolled) or Clerk free tier | Simple to start |
| File storage | Local disk for MVP → S3-compatible (Cloudflare R2 free tier) later | Zero cost at MVP |
| Queue (for ingestion) | BullMQ + Redis (matches existing stack) | Async document processing |
| Deployment | Railway free tier / Render free tier | $0 to start |

---

## 5. Data Models (MongoDB collections)

```
Workspace {
  _id, name, ownerId, createdAt,
  settings: {
    chunkSize, chunkOverlap, topK, llmProvider,
    retrievalStrategy: "vector" | "hybrid",
    confidenceThreshold
  }
}

Document {
  _id, workspaceId, filename, fileType, uploadedAt,
  status: "processing" | "ready" | "failed",
  pageCount, ocrUsed: boolean
}

Chunk {
  _id, documentId, workspaceId, text, pageNumber,
  embeddingId (ref to vector DB), metadata
}

QueryLog {
  _id, workspaceId, userId, question, answer,
  citedChunkIds: [], confidence, createdAt
}

User {
  _id, email, passwordHash, workspaceIds: [], role
}
```

---

## 6. Core Features (MVP Scope)

1. **Upload & Ingest** — drag-drop PDF/DOCX, auto-chunk, embed, store in vector DB. Show processing status.
2. **Ask a Question** — natural language query → retrieve top-k chunks → LLM answers with inline citations (page/section).
3. **Source Viewer** — click a citation, see the exact highlighted passage in the original doc.
4. **Multi-doc Workspace** — query across all documents in a workspace, not just one.
5. **Risk/Clause Flagging (differentiator feature)** — pre-built prompt templates to auto-extract: payment terms, termination clauses, liability caps, renewal dates. Runs automatically after ingestion, surfaces a summary card per document.
6. **Admin Settings Panel** — workspace owner can tune chunk size, top-k, LLM provider, confidence threshold without a redeploy.
7. **Query History** — log of past questions/answers per workspace.

### Explicitly out of scope for MVP
- Multi-tenant billing/Razorpay integration (add after first paying client)
- Team roles/permissions beyond owner (add later)
- Fine-tuning custom models (not needed — use off-the-shelf LLMs)

---

## 7. API Endpoints (initial)

```
POST   /api/workspaces                 — create workspace
POST   /api/documents/upload           — upload + queue for processing
GET    /api/documents/:id/status       — check ingestion status
POST   /api/query                      — ask a question, returns answer + citations
GET    /api/documents/:id/risks        — get auto-extracted clause summary
PATCH  /api/workspaces/:id/settings    — update dynamic config
GET    /api/workspaces/:id/history     — query log
```

---

## 8. Suggested Folder Structure

```
dociq/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   │   ├── ingestion/       (parsing, chunking, embedding)
│   │   │   ├── retrieval/       (vector search, hybrid search)
│   │   │   └── llm/             (provider-agnostic LLM wrapper)
│   │   ├── models/               (Mongo schemas)
│   │   ├── queues/                (BullMQ workers)
│   │   └── config/
│   └── package.json
├── frontend/
│   └── (Next.js app)
└── docs/
```

---

## 9. Build Phases

| Phase | Scope | Est. Time |
|---|---|---|
| 1 | Backend skeleton + doc upload + parsing + chunking | 3–4 days |
| 2 | Embedding pipeline + vector DB integration | 2–3 days |
| 3 | Query endpoint + LLM answer generation w/ citations | 3 days |
| 4 | Frontend: upload UI, chat UI, source viewer | 4–5 days |
| 5 | Risk/clause auto-extraction feature | 2 days |
| 6 | Admin settings panel (dynamic config) | 1–2 days |
| **Total** | | **~2.5–3 weeks** |

---

## 10. Instructions for Claude Code

When starting this build:
1. Scaffold backend first (Node/Express + MongoDB connection + BullMQ/Redis setup).
2. Build the ingestion pipeline as an isolated, testable module (`services/ingestion`) before touching the API layer — this is the highest-risk part (parsing edge cases, chunking quality).
3. Make the LLM and embedding providers **interface-based** (e.g. `LLMProvider` interface with a Gemini and Groq implementation) so swapping providers is a config change, not a code change.
4. Every tunable parameter listed in Section 3 must read from `workspace.settings`, never be hardcoded.
5. Write a `.env.example` with all required keys (Gemini API key, Mongo URI, Redis URL) — don't commit real secrets.
6. Prioritize Phase 1–3 (backend + retrieval quality) before frontend polish — the retrieval quality is what makes or breaks the product.
7. Add a simple eval script early: 10 sample Q&A pairs on a test document, check citation accuracy manually after each major retrieval change.

---

## 11. Prerequisites / Setup Checklist

- [ ] Node.js 18+ installed
- [ ] MongoDB (local via Docker, or free Atlas cluster)
- [ ] Redis (local via Docker, for BullMQ)
- [ ] Gemini API key (free tier) or Groq API key
- [ ] (Optional) Qdrant Cloud account if not self-hosting Chroma

---

## 12. Future Roadmap (post-MVP)

- Hybrid search (BM25 + vector) for better retrieval on exact terms (dates, amounts)
- Reranking model for improved top-k precision
- Team roles & permissions
- Razorpay billing integration for paid tiers
- Slack/email integration for automated document alerts
