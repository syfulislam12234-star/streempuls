/**
 * BullMQ Queue & Redis Connection Manager
 * High-performance Redis connection using ioredis optimized for BullMQ stream dispatching.
 */
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// Redis connection options optimized for BullMQ requirements
export const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  maxRetriesPerRequest: null, // REQUIRED by BullMQ to prevent request timeout errors
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 3000);
    console.warn(`[Redis] Connection reconnect attempt #${times} in ${delay}ms...`);
    return delay;
  },
};

// Primary Redis instance for general operations & Pub/Sub
export const redisClient = new Redis(redisConfig);

redisClient.on('connect', () => {
  console.log('[Redis] Connected successfully to Redis cluster');
});

redisClient.on('error', (err) => {
  console.error('[Redis Client Error]', err.message);
});

// BullMQ Queue for 24/7 stream lifecycle management
export const QUEUE_NAME = process.env.QUEUE_NAME || 'streaming-queue';

export const streamQueue = new Queue(QUEUE_NAME, {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs for audit
      age: 24 * 3600, // 24 hours
    },
    removeOnFail: {
      count: 200,
    },
  },
});

console.log(`[BullMQ] Initialized Queue: "${QUEUE_NAME}"`);

// BullMQ Queue for upload-time video normalization (heavy transcoding, once).
// Runs in a dedicated worker with a Redis slot lock (max 1-2 concurrent jobs)
// and `nice` so it cannot starve live streams, the API, or Redis.
export const NORMALIZE_QUEUE_NAME = process.env.NORMALIZE_QUEUE_NAME || 'normalization-queue';

export const normalizeQueue = new Queue(NORMALIZE_QUEUE_NAME, {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3, // 1 initial + up to 2 retries
    backoff: {
      type: 'exponential',
      delay: 30000,
    },
    removeOnComplete: {
      count: 50,
      age: 24 * 3600,
    },
    removeOnFail: {
      count: 100,
    },
  },
});

console.log(`[BullMQ] Initialized Queue: "${NORMALIZE_QUEUE_NAME}"`);
