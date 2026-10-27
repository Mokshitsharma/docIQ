# docIQ System Design & Architecture

## 1. System Overview
docIQ is a multi-tenant RAG document intelligence platform supporting PDF/DOCX parsing, chunking with overlap, hybrid retrieval (Okapi BM25 + dense embeddings via all-MiniLM-L6-v2 / OpenAI), and grounded LLM generation with verbatim citation verification.

---

## 2. Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Clients ["Web & API Clients"]
        CLI["Next.js Web Interface / API Clients"]
    end

    subgraph SecurityBoundary ["Security & Gateway Layer"]
        SEC["Helmet + Security Headers"]
        RATE["Rate Limiter (Redis-backed sliding window)"]
        AUTH["Bearer API Key Auth & Workspace Scoping"]
    end

    subgraph IngestPipeline ["Ingestion & Async Queue"]
        UP["Upload Hardening (Magic Bytes, Zip Bomb Guard)"]
        QUEUE["BullMQ Queue (Bounded + DLQ)"]
        CHUNK["Chunker (Fast-check property tested)"]
        BM25["Okapi BM25 Inverted Index"]
        EMBED["Local MiniLM / OpenAI Embeddings"]
    end

    subgraph StorageTier ["Data Tier"]
        S3[("S3 Upload Store (Signed URLs)")]
        MONGO[("MongoDB Atlas (Metadata, Quotas, Logs)")]
        VEC[("Chroma Vector Store / pgvector")]
        REDIS[("Redis Cache (Answers & Embeddings)")]
    end

    subgraph QueryPipeline ["Query & Grounded Generation"]
        QROUTE["SSE Streaming Query Handler"]
        HYBRID["Hybrid Ranker (Dense + BM25 Reciprocal Rank)"]
        INJ["Injection Defense & Canary Quarantine"]
        GEN["Grounded Generator (Extractive Citations)"]
    end

    CLI --> SEC --> RATE --> AUTH
    AUTH -->|Upload| UP --> S3
    UP --> QUEUE --> CHUNK
    CHUNK --> BM25
    CHUNK --> EMBED --> VEC
    CHUNK --> MONGO
    AUTH -->|Query (SSE)| QROUTE
    QROUTE --> REDIS
    QROUTE -->|Cache Miss| HYBRID
    HYBRID --> VEC
    HYBRID --> BM25
    HYBRID --> INJ --> GEN --> CLI
```

---

## 3. Reliability & Asynchronous Processing
- **Bounded BullMQ Queues with Dead-Letter Queue (DLQ):**
  Document parsing and OCR run as isolated BullMQ background jobs. High-complexity files are retried up to 3 times before being moved to the `ingest-dlq` with detailed stack traces.
- **Answer and Embedding Caches:**
  Embeddings are cached by SHA-256 content hash in Redis (permanent TTL). Answers are cached per `(workspaceId, questionHash, docVersion)` (1-hour TTL).
- **Stateless Web Tier:**
  Proven by running two backend instances behind an nginx reverse proxy in `docker-compose.yml`.

---

## 4. Failure Mode Matrix

| Failure Mode | Impact | Recovery / Graceful Degradation |
|---|---|---|
| **Chroma Vector Store Outage** | Dense vector search unavailable. | Degrades automatically to Okapi BM25 lexical keyword search; answers still served. |
| **LLM Provider API Outage** | Grounded answer generation fails. | Returns verbatim retrieved source chunks directly to the user with a "Model Offline" banner. |
| **Poisoned Document (Indirect Injection)** | Attacker attempts prompt override. | Canary scanner flags untrusted instruction; quarantines sentence and notifies user. |
| **Worker Queue Full** | Incoming uploads exceed capacity. | Bounded queue rejects requests above limit with 429 and Retry-After header. |

---

## 5. Capacity & Operational Cost (AWS)
- **ECS Fargate (2 Tasks, 1 vCPU, 2 GB RAM):** ~$30/month.
- **S3 Storage + Transfer (50 GB):** ~$1.50/month.
- **Redis ElastiCache (cache.t4g.micro):** ~$12/month.
- **MongoDB Atlas (M0 Free Tier):** $0.00/month.
- **Cost per 1,000 Queries:** **~$0.45** (embedding cache hit ratio > 65%).
