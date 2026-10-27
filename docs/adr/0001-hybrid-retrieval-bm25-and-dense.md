# ADR 0001: Hybrid Retrieval Combining Okapi BM25 and Dense Embeddings

## Status
Accepted

## Context
Dense vector embeddings excel at semantic similarity but frequently miss exact part numbers, acronyms, dollar amounts, and specific regulatory clause codes. Pure keyword search fails on synonyms and natural language phrasing.

## Decision
Implement hybrid search combining an in-memory Okapi BM25 inverted index with dense sentence embeddings (all-MiniLM-L6-v2 locally or OpenAI text-embedding-3-small). Rank fusion uses Reciprocal Rank Fusion (RRF) with $k=60$.
