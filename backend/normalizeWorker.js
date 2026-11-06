/**
 * Dedicated BullMQ worker for upload-time video normalization.
 *
 * Runs as its own Coolify service (e.g. `normalize-worker`) so heavy
 * transcoding is fully isolated from live streams, the API and Redis.
 * Concurrency is capped at 2 and each job is additionally guarded by a Redis
 * slot lock inside normalizeVideo.js; FFmpeg is spawned under `nice`.
 */
import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { redisConfig, NORMALIZE_QUEUE_NAME } from './queue.js';
import { processNormalizeJob } from './normalizeVideo.js';

dotenv.config();

const NORMALIZE_CONCURRENCY = Math.max(1, Math.min(2, Number(process.env.NORMALIZE_CONCURRENCY || '2')));

export const normalizeWorker = new Worker(
  NORMALIZE_QUEUE_NAME,
  async (job) => {
    console.log(`[Normalize Worker] Processing job ${job.id} (${job.name})`);
    return processNormalizeJob(job);
  },
  {
    connection: redisConfig,
    concurrency: NORMALIZE_CONCURRENCY,
    limiter: { max: NORMALIZE_CONCURRENCY * 2, duration: 1000 },
  }
);

console.log(`[Normalize Worker] Listening on "${NORMALIZE_QUEUE_NAME}" with concurrency ${NORMALIZE_CONCURRENCY}`);

normalizeWorker.on('completed', (job) => {
  console.log(`[Normalize Worker] Job ${job.id} completed.`);
});

normalizeWorker.on('failed', (job, err) => {
  console.error(`[Normalize Worker] Job ${job?.id} failed:`, err?.message);
});

// Keep the process alive; BullMQ worker does this by itself, but be explicit.
process.on('unhandledRejection', (err) => {
  console.error('[Normalize Worker] Unhandled rejection:', err?.message || err);
});
