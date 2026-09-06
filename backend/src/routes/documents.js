import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import Document from '../models/Document.js';
import Chunk from '../models/Chunk.js';
import Workspace from '../models/Workspace.js';
import { asyncH } from '../middleware/error.js';
import { detectFileType } from '../services/ingestion/parser.js';
import { enqueueIngestion } from '../queues/ingestionQueue.js';
import { deleteDocument } from '../services/ingestion/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_').slice(-120);
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    const ok = detectFileType(file.originalname);
    cb(ok ? null : new Error('Unsupported file type (pdf, docx, txt, md only)'), !!ok);
  },
});

const router = Router();
const badId = (id) => !mongoose.isValidObjectId(id);

// POST /api/documents/upload   (multipart: file, workspaceId)
router.post(
  '/upload',
  upload.single('file'),
  asyncH(async (req, res) => {
    const { workspaceId } = req.body || {};
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    if (badId(workspaceId)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'valid workspaceId is required' });
    }
    const ws = await Workspace.findById(workspaceId);
    if (!ws) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'workspace not found' });
    }

    const doc = await Document.create({
      workspaceId,
      filename: req.file.originalname,
      storedPath: req.file.path,
      fileType: detectFileType(req.file.originalname),
      sizeBytes: req.file.size,
      status: 'processing',
    });

    const { mode } = await enqueueIngestion(doc._id);
    res.status(202).json({ document: doc, ingestion: mode });
  })
);

// GET /api/documents?workspaceId=
router.get(
  '/',
  asyncH(async (req, res) => {
    const q = {};
    if (req.query.workspaceId && mongoose.isValidObjectId(req.query.workspaceId)) {
      q.workspaceId = req.query.workspaceId;
    }
    const docs = await Document.find(q).sort({ createdAt: -1 }).lean();
    res.json(docs);
  })
);

// GET /api/documents/:id/status
router.get(
  '/:id/status',
  asyncH(async (req, res) => {
    if (badId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const doc = await Document.findById(req.params.id)
      .select('filename status error pageCount chunkCount ocrUsed createdAt updatedAt')
      .lean();
    if (!doc) return res.status(404).json({ error: 'document not found' });
    res.json(doc);
  })
);

// GET /api/documents/:id/risks
router.get(
  '/:id/risks',
  asyncH(async (req, res) => {
    if (badId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const doc = await Document.findById(req.params.id).select('filename status risks').lean();
    if (!doc) return res.status(404).json({ error: 'document not found' });
    if (doc.status !== 'ready') {
      return res.status(409).json({ error: `document is "${doc.status}"`, status: doc.status });
    }
    res.json({ documentId: req.params.id, filename: doc.filename, risks: doc.risks || null });
  })
);

// GET /api/documents/:id/chunks/:ordinal  — source viewer
router.get(
  '/:id/chunks/:ordinal',
  asyncH(async (req, res) => {
    if (badId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const chunk = await Chunk.findOne({
      documentId: req.params.id,
      ordinal: Number(req.params.ordinal),
    }).lean();
    if (!chunk) return res.status(404).json({ error: 'chunk not found' });
    res.json(chunk);
  })
);

// GET /api/documents/:id/chunk-by-id/:chunkId  — source viewer (by id)
router.get(
  '/chunk/:chunkId',
  asyncH(async (req, res) => {
    if (badId(req.params.chunkId)) return res.status(400).json({ error: 'invalid id' });
    const chunk = await Chunk.findById(req.params.chunkId).lean();
    if (!chunk) return res.status(404).json({ error: 'chunk not found' });
    res.json(chunk);
  })
);

// DELETE /api/documents/:id
router.delete(
  '/:id',
  asyncH(async (req, res) => {
    if (badId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    await deleteDocument(req.params.id);
    res.status(204).end();
  })
);

export default router;
