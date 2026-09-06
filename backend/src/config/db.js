import mongoose from 'mongoose';
import config from './index.js';
import logger from '../utils/logger.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
  logger.info(`MongoDB connected: ${mongoose.connection.name}`);
  return mongoose.connection;
}

export default connectDB;
