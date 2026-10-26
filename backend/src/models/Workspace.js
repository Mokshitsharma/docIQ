import mongoose from 'mongoose';
import config from '../config/index.js';

const settingsSchema = new mongoose.Schema(
  {
    chunkSize: { type: Number, default: () => config.defaults.chunkSize },
    chunkOverlap: { type: Number, default: () => config.defaults.chunkOverlap },
    topK: { type: Number, default: () => config.defaults.topK },
    llmProvider: { type: String, default: () => config.llmProvider },
    embeddingProvider: { type: String, default: () => config.embeddingProvider },
    retrievalStrategy: {
      type: String,
      enum: ['vector', 'hybrid'],
      default: () => config.defaults.retrievalStrategy,
    },
    confidenceThreshold: {
      type: Number,
      default: () => config.defaults.confidenceThreshold,
    },
  },
  { _id: false }
);

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    settings: { type: settingsSchema, default: () => ({}) },
    // sha256 of the workspace access key (the key itself is returned once, on create). Never selected by default.
    accessKeyHash: { type: String, select: false },
    // Bumped on every ingest/delete/settings change; part of the answer-cache key.
    contentVersion: { type: Number, default: 0 },
    // Public demo workspace (seeded): readable/queryable with its published demo key.
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Whitelist of runtime-editable settings keys (admin panel / PATCH).
export const EDITABLE_SETTINGS = [
  'chunkSize',
  'chunkOverlap',
  'topK',
  'llmProvider',
  'embeddingProvider',
  'retrievalStrategy',
  'confidenceThreshold',
];

export default mongoose.model('Workspace', workspaceSchema);
