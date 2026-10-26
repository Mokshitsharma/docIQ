import mongoose from 'mongoose';

/** Per-tenant daily usage counters (quotas and LLM cost budget). One row per workspace per UTC day. */
const usageSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    day: { type: String, required: true }, // YYYY-MM-DD (UTC)
    queries: { type: Number, default: 0 },
    llmCalls: { type: Number, default: 0 },
    llmCostUsd: { type: Number, default: 0 },
    // Rows expire 90 days after creation.
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
  },
  { versionKey: false }
);
usageSchema.index({ workspaceId: 1, day: 1 }, { unique: true });

export default mongoose.model('Usage', usageSchema);
