import { Router } from 'express';
import mongoose from 'mongoose';
import { asyncH } from '../middleware/error.js';
import { authorizeWorkspace } from '../middleware/workspaceAuth.js';
import { queryLimiter } from '../middleware/rateLimit.js';
import { answerQuestion } from '../services/query/answerer.js';
import QueryLog from '../models/QueryLog.js';

const router = Router();
export const MAX_QUESTION_CHARS = 2000;

function validate(body = {}) {
  const { question, userId } = body;
  if (typeof question !== 'string' || !question.trim()) {
    throw Object.assign(new Error('question is required'), { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    throw Object.assign(new Error(`question too long (max ${MAX_QUESTION_CHARS} chars)`), { status: 400 });
  }
  return { question: question.trim(), userId: userId && mongoose.isValidObjectId(userId) ? userId : undefined };
}

// POST /api/query   { workspaceId, question, userId? }
router.post(
  '/',
  queryLimiter,
  asyncH(async (req, res) => {
    const ws = await authorizeWorkspace(req, req.body?.workspaceId);
    const { question, userId } = validate(req.body);
    res.json(await answerQuestion({ workspaceId: ws._id, question, userId }));
  })
);

// POST /api/query/stream — same as /api/query, as Server-Sent Events:
//   event: retrieved  {chunks}   (as soon as retrieval finishes)
//   event: token      {text}     (answer, word by word)
//   event: done       {full result}
//   event: error      {error}
router.post(
  '/stream',
  queryLimiter,
  asyncH(async (req, res) => {
    const ws = await authorizeWorkspace(req, req.body?.workspaceId);
    const { question, userId } = validate(req.body);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    try {
      const result = await answerQuestion({
        workspaceId: ws._id,
        question,
        userId,
        onRetrieved: (chunks) => !closed && send('retrieved', { chunks }),
      });
      // Providers return complete answers today, so the answer is streamed after generation.
      for (const piece of result.answer.match(/\S+\s*/g) || []) {
        if (closed) return;
        send('token', { text: piece });
      }
      send('done', result);
    } catch (err) {
      send('error', { error: err.status && err.status < 500 ? err.message : 'Internal server error', status: err.status || 500 });
    }
    res.end();
  })
);

// POST /api/query/:queryId/feedback   { rating: "up"|"down", comment? }
router.post(
  '/:queryId/feedback',
  asyncH(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.queryId)) return res.status(400).json({ error: 'invalid id' });
    const { rating, comment } = req.body || {};
    if (!['up', 'down'].includes(rating)) return res.status(400).json({ error: 'rating must be "up" or "down"' });
    if (comment !== undefined && (typeof comment !== 'string' || comment.length > 1000)) {
      return res.status(400).json({ error: 'comment must be a string (max 1000 chars)' });
    }
    const log = await QueryLog.findById(req.params.queryId).select('workspaceId').lean();
    if (!log) return res.status(404).json({ error: 'query not found' });
    try {
      await authorizeWorkspace(req, log.workspaceId);
    } catch (err) {
      if (err.status === 401) throw err;
      return res.status(404).json({ error: 'query not found' });
    }
    await QueryLog.updateOne({ _id: log._id }, { feedback: { rating, comment, at: new Date() } });
    res.status(204).end();
  })
);

export default router;
