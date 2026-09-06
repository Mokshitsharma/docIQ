import { Router } from 'express';
import mongoose from 'mongoose';
import Workspace, { EDITABLE_SETTINGS } from '../models/Workspace.js';
import Document from '../models/Document.js';
import QueryLog from '../models/QueryLog.js';
import { asyncH } from '../middleware/error.js';

const router = Router();

const badId = (id) => !mongoose.isValidObjectId(id);

// POST /api/workspaces
router.post(
  '/',
  asyncH(async (req, res) => {
    const { name, ownerId } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const ws = await Workspace.create({
      name: name.trim(),
      ownerId: ownerId && mongoose.isValidObjectId(ownerId) ? ownerId : undefined,
    });
    res.status(201).json(ws);
  })
);

// GET /api/workspaces
router.get(
  '/',
  asyncH(async (_req, res) => {
    const list = await Workspace.find().sort({ createdAt: -1 }).lean();
    res.json(list);
  })
);

// GET /api/workspaces/:id
router.get(
  '/:id',
  asyncH(async (req, res) => {
    if (badId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const ws = await Workspace.findById(req.params.id).lean();
    if (!ws) return res.status(404).json({ error: 'workspace not found' });
    const [docCount, queryCount] = await Promise.all([
      Document.countDocuments({ workspaceId: ws._id }),
      QueryLog.countDocuments({ workspaceId: ws._id }),
    ]);
    res.json({ ...ws, stats: { docCount, queryCount } });
  })
);

// PATCH /api/workspaces/:id/settings  — dynamic config, no redeploy
router.patch(
  '/:id/settings',
  asyncH(async (req, res) => {
    if (badId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const ws = await Workspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'workspace not found' });

    const patch = req.body || {};
    const applied = {};
    const rejected = {};

    for (const [key, value] of Object.entries(patch)) {
      if (!EDITABLE_SETTINGS.includes(key)) {
        rejected[key] = 'unknown setting';
        continue;
      }
      const err = validateSetting(key, value);
      if (err) {
        rejected[key] = err;
        continue;
      }
      ws.settings[key] = value;
      applied[key] = value;
    }

    if (Object.keys(applied).length === 0) {
      return res.status(400).json({ error: 'no valid settings to update', rejected });
    }

    await ws.save();
    res.json({ settings: ws.settings, applied, rejected });
  })
);

// GET /api/workspaces/:id/history
router.get(
  '/:id/history',
  asyncH(async (req, res) => {
    if (badId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const logs = await QueryLog.find({ workspaceId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json(logs);
  })
);

function validateSetting(key, value) {
  const intInRange = (min, max) =>
    Number.isInteger(value) && value >= min && value <= max
      ? null
      : `must be an integer in [${min}, ${max}]`;
  switch (key) {
    case 'chunkSize':
      return intInRange(100, 4000);
    case 'chunkOverlap':
      return intInRange(0, 1000);
    case 'topK':
      return intInRange(1, 25);
    case 'confidenceThreshold':
      return typeof value === 'number' && value >= 0 && value <= 1
        ? null
        : 'must be a number in [0, 1]';
    case 'retrievalStrategy':
      return ['vector', 'hybrid'].includes(value) ? null : 'must be "vector" or "hybrid"';
    case 'llmProvider':
      return ['gemini', 'groq', 'openai', 'extractive'].includes(value)
        ? null
        : 'must be one of gemini|groq|openai|extractive';
    case 'embeddingProvider':
      return ['local', 'gemini'].includes(value) ? null : 'must be "local" or "gemini"';
    default:
      return 'unknown setting';
  }
}

export default router;
