import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    filename: { type: String, required: true },
    storedPath: { type: String, required: true },
    fileType: { type: String, required: true }, // pdf | docx | txt
    sizeBytes: Number,
    status: {
      type: String,
      enum: ['processing', 'ready', 'failed'],
      default: 'processing',
      index: true,
    },
    error: String,
    pageCount: { type: Number, default: 0 },
    chunkCount: { type: Number, default: 0 },
    ocrUsed: { type: Boolean, default: false },
    risks: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('Document', documentSchema);
