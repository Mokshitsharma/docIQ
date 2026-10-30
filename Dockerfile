# Hugging Face Spaces (Docker SDK) image for the docIQ API. Spaces build the repo-root
# Dockerfile, so this wraps backend/ (same image as backend/deploy/container/Dockerfile).
#
# Demo mode (default): no MONGO_URI → an in-memory MongoDB with the "Demo — Sample MSA"
# workspace seeded on every start. Set a MONGO_URI secret (e.g. MongoDB Atlas M0) to keep data.
# Debian (not Alpine) because the in-memory MongoDB binary needs glibc.
FROM node:20-slim

WORKDIR /app
ENV MONGOMS_DOWNLOAD_DIR=/app/.cache/mongodb-binaries

COPY backend/package.json backend/package-lock.json ./
# Dev dependencies are kept: mongodb-memory-server powers the demo mode and
# @huggingface/transformers powers the free MiniLM embeddings.
RUN npm ci

COPY backend/ ./
# Download the MongoDB binary and the MiniLM model at build time so startup is fast.
RUN node -e "import('mongodb-memory-server').then(async (m) => { const s = await m.MongoMemoryServer.create(); await s.stop(); })" \
    && node -e "import('@huggingface/transformers').then((t) => t.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' }))" \
    && mkdir -p uploads && chown -R node /app

ENV NODE_ENV=production PORT=7860 USE_QUEUE=false VECTOR_STORE=memory \
    EMBEDDING_PROVIDER=minilm LLM_PROVIDER=extractive SEED_DEMO=true \
    UPLOAD_MAX_BYTES=5242880 UPLOAD_MAX_PDF_PAGES=100 QUOTA_MAX_DOCS=20 QUOTA_MAX_QUERIES_PER_DAY=300
# The node image's "node" user is uid 1000, which Spaces expect.
USER node
EXPOSE 7860
CMD ["sh", "-c", "if [ -n \"$MONGO_URI\" ]; then node src/index.js; else node scripts/dev-with-memory-db.js; fi"]
