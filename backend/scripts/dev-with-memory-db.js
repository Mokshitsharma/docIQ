/**
 * Run the full API on localhost with zero external services.
 *
 *   npm run dev:mem
 *
 * Starts an ephemeral in-memory MongoDB (mongodb-memory-server), points
 * MONGO_URI at it, then boots the normal Express app. Everything else
 * (vector store, LLM, embeddings, queue) already has an offline default.
 *
 * Data is wiped when the process exits — use a real MONGO_URI + `npm run dev`
 * for anything you want to keep.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri('dociq');
process.env.USE_QUEUE = process.env.USE_QUEUE || 'false';
process.env.SEED_DEMO = process.env.SEED_DEMO || 'true';

console.log('[dev:mem] in-memory MongoDB at', process.env.MONGO_URI);

const { connectDB } = await import('../src/config/db.js');
const { default: createApp } = await import('../src/index.js');
const config = (await import('../src/config/index.js')).default;
const { seedDemo } = await import('../src/config/seed.js');

await connectDB();
const app = createApp();
const server = app.listen(config.port, async () => {
  console.log(`[dev:mem] DocIQ API on http://localhost:${config.port}`);
  if (config.seedDemo) await seedDemo();
  console.log('[dev:mem] ready');
});

async function shutdown() {
  console.log('\n[dev:mem] shutting down…');
  server.close();
  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
