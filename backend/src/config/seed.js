import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Workspace from '../models/Workspace.js';
import Document from '../models/Document.js';
import { ingestDocument } from '../services/ingestion/index.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../eval/fixtures/sample-msa.txt');
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

export const DEMO_WORKSPACE_NAME = 'Demo — Sample MSA';

/**
 * Idempotently create a "Demo" workspace containing the sample Master Services
 * Agreement, fully ingested. Safe to call on every startup — it no-ops if the
 * demo workspace already has a ready document.
 */
export async function seedDemo() {
  try {
    let ws = await Workspace.findOne({ name: DEMO_WORKSPACE_NAME });
    if (!ws) {
      ws = await Workspace.create({
        name: DEMO_WORKSPACE_NAME,
        // smaller chunks suit this short contract better than the 800-token default
        settings: { chunkSize: 300, chunkOverlap: 60, retrievalStrategy: 'hybrid' },
      });
      logger.info(`seed: created workspace "${DEMO_WORKSPACE_NAME}"`);
    }

    const existing = await Document.findOne({ workspaceId: ws._id, filename: 'sample-msa.txt' });
    if (existing && existing.status === 'ready') {
      logger.info('seed: demo document already ingested — skipping');
      return ws;
    }

    if (!fs.existsSync(FIXTURE)) {
      logger.warn(`seed: fixture not found at ${FIXTURE} — skipping`);
      return ws;
    }

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const storedPath = path.join(UPLOAD_DIR, `seed_sample-msa.txt`);
    fs.copyFileSync(FIXTURE, storedPath);

    const doc =
      existing ||
      (await Document.create({
        workspaceId: ws._id,
        filename: 'sample-msa.txt',
        storedPath,
        fileType: 'txt',
        sizeBytes: fs.statSync(storedPath).size,
        status: 'processing',
      }));
    if (existing) {
      existing.storedPath = storedPath;
      existing.status = 'processing';
      await existing.save();
    }

    await ingestDocument(doc._id);
    logger.info('seed: demo MSA ingested and ready');
    return ws;
  } catch (err) {
    logger.warn(`seed: failed (${err.message}) — continuing without demo data`);
  }
}

export default seedDemo;
