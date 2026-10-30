import { Router } from 'express';
import mongoose from 'mongoose';
import Workspace, { EDITABLE_SETTINGS } from '../models/Workspace.js';
import Document from '../models/Document.js';
import QueryLog from '../models/QueryLog.js';
import { asyncH } from '../middleware/error.js';
import config from '../config/index.js';
import { generateKey, hashKey, requireWorkspaceParam } from '../middleware/workspaceAuth.js';

const router = Router();


// POST /api/workspaces
router.post(
  '/',
  asyncH(async (req, res) => {
    const { name, ownerId } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 200) {
      return res.status(400).json({ error: 'name is required (string, max 200 chars)' });
    }
    const accessKey = generateKey();
    const ws = await Workspace.create({
      name: name.trim(),
      ownerId: ownerId && mongoose.isValidObjectId(ownerId) ? ownerId : undefined,
      accessKeyHash: hashKey(accessKey),
    });
    const out = ws.toObject();
    delete out.accessKeyHash;
    // The key is returned exactly once; only its hash is stored.
    res.status(201).json({ ...out, accessKey });
  })
);

// GET /api/workspaces
router.get(
  '/',
  asyncH(async (_req, res) => {
    // With tenant isolation on, listing every tenant would leak names/ids: only public demo workspaces are listed.
    const filter = config.workspaceAuth ? { isDemo: true } : {};
    const list = await Workspace.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.json(list);
  })
);

// GET /api/workspaces/demo  — the seeded public demo workspace and its (public) key
router.get(
  '/demo',
  asyncH(async (_req, res) => {
    const ws = await Workspace.findOne({ isDemo: true }).lean();
    if (!ws || !config.demoWorkspaceKey) return res.status(404).json({ error: 'no demo workspace' });
    res.json({ ...ws, accessKey: config.demoWorkspaceKey });
  })
);

// GET /api/workspaces/:id
router.get(
  '/:id',
  requireWorkspaceParam(),
  asyncH(async (req, res) => {
    const ws = req.workspace;
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
  requireWorkspaceParam(),
  asyncH(async (req, res) => {
    if (req.workspace.isDemo && config.workspaceAuth) return res.status(403).json({ error: 'demo workspace is read-only' });
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

    ws.contentVersion = (ws.contentVersion || 0) + 1; // invalidates cached answers
    await ws.save();
    res.json({ settings: ws.settings, applied, rejected });
  })
);

// GET /api/workspaces/:id/history
router.get(
  '/:id/history',
  requireWorkspaceParam(),
  asyncH(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const q = { workspaceId: req.workspace._id };
    // Cursor pagination: ?before=<ISO date> returns older entries.
    if (req.query.before && !Number.isNaN(Date.parse(req.query.before))) q.createdAt = { $lt: new Date(req.query.before) };
    const logs = await QueryLog.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(logs);
  })
);

// POST /api/workspaces/:id/rotate-key — rotate capability key
router.post(
  '/:id/rotate-key',
  requireWorkspaceParam(),
  asyncH(async (req, res) => {
    if (req.workspace.isDemo && config.workspaceAuth) {
      return res.status(403).json({ error: 'demo workspace key cannot be rotated' });
    }
    const newKey = generateKey();
    await Workspace.updateOne({ _id: req.workspace._id }, { accessKeyHash: hashKey(newKey) });
    res.json({ accessKey: newKey, message: 'key rotated successfully; previous key is invalidated' });
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
      return ['local', 'minilm', 'gemini'].includes(value) ? null : 'must be "local", "minilm" or "gemini"';
    default:
      return 'unknown setting';
  }
}

export default router;
