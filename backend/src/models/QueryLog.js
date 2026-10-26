import mongoose from 'mongoose';

const queryLogSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    question: { type: String, required: true },
    answer: { type: String, default: '' },
    grounded: { type: Boolean, default: false },
    confidence: { type: Number, default: 0 },
    citedChunkIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Chunk' }],
    citations: { type: mongoose.Schema.Types.Mixed, default: [] },
    llmProvider: String,
    latencyMs: Number,
    cached: { type: Boolean, default: false },
    costUsd: { type: Number, default: 0 },
    // Optional user feedback (POST /api/query/:queryId/feedback).
    feedback: {
      rating: { type: String, enum: ['up', 'down'] },
      comment: { type: String, maxlength: 1000 },
      at: Date,
    },
  },
  { timestamps: true }
);

queryLogSchema.index({ workspaceId: 1, createdAt: -1 });

export default mongoose.model('QueryLog', queryLogSchema);
