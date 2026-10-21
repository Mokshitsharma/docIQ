# docIQ API container image (Render, Google Cloud Run or Hugging Face Spaces).
# Build context is backend/ (see render.yaml).
#
# Demo mode (default): no MONGO_URI → an in-memory MongoDB with the "Demo — Sample MSA"
# workspace seeded on every start. Set a MONGO_URI secret (e.g. MongoDB Atlas M0) to keep data.
# Debian (not Alpine) because the in-memory MongoDB binary needs glibc.
FROM node:20-slim

WORKDIR /app
ENV MONGOMS_DOWNLOAD_DIR=/app/.cache/mongodb-binaries

COPY package.json package-lock.json* ./
# Dev dependencies are kept: mongodb-memory-server powers the demo mode.
RUN npm ci

COPY . .
# Download the MongoDB binary at build time so startup is fast.
RUN node -e "import('mongodb-memory-server').then(async (m) => { const s = await m.MongoMemoryServer.create(); await s.stop(); })" \
    && mkdir -p uploads && chown -R node /app

ENV NODE_ENV=production PORT=7860 USE_QUEUE=false VECTOR_STORE=memory \
    EMBEDDING_PROVIDER=local LLM_PROVIDER=extractive SEED_DEMO=true
# The node image's "node" user is uid 1000, which Spaces expect.
USER node
EXPOSE 7860
CMD ["sh", "-c", "if [ -n \"$MONGO_URI\" ]; then node src/index.js; else node scripts/dev-with-memory-db.js; fi"]
