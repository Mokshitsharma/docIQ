import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    workspaceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Workspace' }],
    role: { type: String, enum: ['owner', 'member'], default: 'owner' },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
