import mongoose from 'mongoose';

const chunkSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    ordinal: { type: Number, required: true }, // position within the document
    text: { type: String, required: true },
    pageNumber: { type: Number, default: 1 },
    embeddingId: { type: String, index: true }, // ref into the vector store
    tokenCount: Number,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model('Chunk', chunkSchema);
