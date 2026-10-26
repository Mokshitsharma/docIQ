import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import Document from '../models/Document.js';
import Chunk from '../models/Chunk.js';
import Workspace from '../models/Workspace.js';
import config from '../config/index.js';
import { asyncH } from '../middleware/error.js';
import { authorizeWorkspace } from '../middleware/workspaceAuth.js';
import { validateUpload } from '../services/ingestion/fileGuard.js';
import { getStorage, newObjectKey } from '../services/storage/index.js';
import { enqueueIngestion } from '../queues/ingestionQueue.js';
import { deleteDocument } from '../services/ingestion/index.js';
import { uploadLimiter } from '../middleware/rateLimit.js';

// Memory storage: bytes are sniffed and bomb-checked before anything is written anywhere.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.maxBytes, files: 1, fields: 5, fieldSize: 1024, parts: 8 },
});

const router = Router();
const badId = (id) => !mongoose.isValidObjectId(id);
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });

/** Load a row by id and check the caller holds the key of the workspace that owns it. 404 otherwise. */
async function loadOwned(req, Model, id, select) {
  if (badId(id)) throw Object.assign(new Error('invalid id'), { status: 400 });
  const query = Model.findById(id);
  if (select) query.select(select);
  const row = await query.lean();
  if (!row) throw notFound(Model.modelName.toLowerCase());
  try {
    req.workspace = await authorizeWorkspace(req, row.workspaceId);
  } catch (err) {
    if (err.status === 401) throw err;
    throw notFound(Model.modelName.toLowerCase()); // never confirm another tenant's id exists
  }
  return row;
}

const readOnlyDemo = (ws) => ws.isDemo && config.workspaceAuth;

// POST /api/documents/upload   (multipart: file, workspaceId)
router.post(
  '/upload',
  uploadLimiter,
  upload.single('file'),
  asyncH(async (req, res) => {
    const { workspaceId } = req.body || {};
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const ws = await authorizeWorkspace(req, workspaceId);
    if (readOnlyDemo(ws)) return res.status(403).json({ error: 'demo workspace is read-only' });

    const count = await Document.countDocuments({ workspaceId: ws._id });
    if (count >= config.quotas.maxDocsPerWorkspace) {
      res.set('Retry-After', '86400');
      return res.status(429).json({ error: `document quota reached (${config.quotas.maxDocsPerWorkspace})`, code: 'quota_documents' });
    }

    const { fileType, filename } = await validateUpload(req.file);
    const storedPath = await getStorage().put(newObjectKey(ws._id, fileType), req.file.buffer, fileType);

    const doc = await Document.create({
      workspaceId: ws._id,
      filename,
      storedPath,
      fileType,
      sizeBytes: req.file.size,
      status: 'processing',
    });

    let mode;
    try {
      ({ mode } = await enqueueIngestion(doc._id));
    } catch (err) {
      await Document.updateOne({ _id: doc._id }, { status: 'failed', error: err.message });
      throw err;
    }
    res.status(202).json({ document: publicDoc(doc.toObject()), ingestion: mode });
  })
);

// GET /api/documents?workspaceId=&limit=&before=
router.get(
  '/',
  asyncH(async (req, res) => {
    const ws = await authorizeWorkspace(req, req.query.workspaceId);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 200);
    const q = { workspaceId: ws._id };
    if (req.query.before && !Number.isNaN(Date.parse(req.query.before))) q.createdAt = { $lt: new Date(req.query.before) };
    const docs = await Document.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(docs.map(publicDoc));
  })
);

// GET /api/documents/:id/status
router.get(
  '/:id/status',
  asyncH(async (req, res) => {
    const doc = await loadOwned(req, Document, req.params.id, 'workspaceId filename status error pageCount chunkCount ocrUsed createdAt updatedAt');
    res.json(publicDoc(doc));
  })
);

// GET /api/documents/:id/risks
router.get(
  '/:id/risks',
  asyncH(async (req, res) => {
    const doc = await loadOwned(req, Document, req.params.id, 'workspaceId filename status risks');
    if (doc.status !== 'ready') {
      return res.status(409).json({ error: `document is "${doc.status}"`, status: doc.status });
    }
    res.json({ documentId: req.params.id, filename: doc.filename, risks: doc.risks || null });
  })
);

// GET /api/documents/:id/download — pre-signed S3 URL (s3) or the bytes (local)
router.get(
  '/:id/download',
  asyncH(async (req, res) => {
    const doc = await loadOwned(req, Document, req.params.id, 'workspaceId filename storedPath fileType');
    const storage = getStorage();
    const url = await storage.signedUrl(doc.storedPath, doc.filename);
    if (url) return res.json({ url, expiresInSec: config.storage.signedUrlTtlSec });
    const buf = await storage.get(doc.storedPath);
    res.attachment(doc.filename).type('application/octet-stream').send(buf);
  })
);

// GET /api/documents/:id/chunks/:ordinal  — source viewer
router.get(
  '/:id/chunks/:ordinal',
  asyncH(async (req, res) => {
    const doc = await loadOwned(req, Document, req.params.id, 'workspaceId');
    const ordinal = Number.parseInt(req.params.ordinal, 10);
    if (!Number.isInteger(ordinal) || ordinal < 0) return res.status(400).json({ error: 'invalid ordinal' });
    const chunk = await Chunk.findOne({ documentId: doc._id, workspaceId: doc.workspaceId, ordinal }).lean();
    if (!chunk) return res.status(404).json({ error: 'chunk not found' });
    res.json(chunk);
  })
);

// GET /api/documents/chunk/:chunkId  — source viewer (by id)
router.get(
  '/chunk/:chunkId',
  asyncH(async (req, res) => {
    const chunk = await loadOwned(req, Chunk, req.params.chunkId);
    res.json(chunk);
  })
);

// DELETE /api/documents/:id
router.delete(
  '/:id',
  asyncH(async (req, res) => {
    const doc = await loadOwned(req, Document, req.params.id, 'workspaceId');
    if (readOnlyDemo(req.workspace)) return res.status(403).json({ error: 'demo workspace is read-only' });
    await deleteDocument(doc._id);
    await Workspace.updateOne({ _id: doc.workspaceId }, { $inc: { contentVersion: 1 } });
    res.status(204).end();
  })
);

/** storedPath is internal (a server path or bucket key); never return it. */
function publicDoc(d) {
  const { storedPath: _s, ...rest } = d;
  return rest;
}

export default router;
