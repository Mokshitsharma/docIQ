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
