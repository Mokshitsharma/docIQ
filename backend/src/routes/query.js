import { Router } from 'express';
import mongoose from 'mongoose';
import { asyncH } from '../middleware/error.js';
import { answerQuestion } from '../services/query/answerer.js';

const router = Router();

// POST /api/query   { workspaceId, question, userId? }
router.post(
  '/',
  asyncH(async (req, res) => {
    const { workspaceId, question, userId } = req.body || {};
    if (!mongoose.isValidObjectId(workspaceId)) {
      return res.status(400).json({ error: 'valid workspaceId is required' });
    }
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }
    const result = await answerQuestion({
      workspaceId,
      question: question.trim(),
      userId: userId && mongoose.isValidObjectId(userId) ? userId : undefined,
    });
    res.json(result);
  })
);

export default router;
