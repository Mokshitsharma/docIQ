# ADR 0002: Architectural Roadmap for Moving from Chroma to pgvector at Scale

## Status
Accepted

## Context
Chroma provides an excellent developer experience and local file-backed vector storage for MVP development and offline testing. However, at scale (>100,000 documents across 1,000 tenants), operating embedded SQLite Chroma creates disk locking contention and horizontal scaling hurdles.

## Decision
Retain Chroma for offline development and test suites. For production cloud scale, migrate vector storage to PostgreSQL with the `pgvector` extension (HNSW indexes). This colocates relational metadata, document chunks, tenant quotas, and vector embeddings in a single ACID-compliant database with row-level security (`CREATE POLICY tenant_isolation`).
