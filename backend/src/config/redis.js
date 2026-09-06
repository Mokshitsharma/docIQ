import IORedis from 'ioredis';
import config from './index.js';
import logger from '../utils/logger.js';

let connection = null;

export function getRedis() {
  if (!config.useQueue) return null;
  if (connection) return connection;
  connection = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  connection.on('error', (e) => logger.error('Redis error:', e.message));
  connection.on('connect', () => logger.info('Redis connected'));
  return connection;
}

export default getRedis;
