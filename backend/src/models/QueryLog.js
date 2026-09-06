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
  },
  { timestamps: true }
);

export default mongoose.model('QueryLog', queryLogSchema);
