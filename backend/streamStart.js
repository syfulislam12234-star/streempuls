import { withRedisLease } from './redisLease.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const STREAMS_FILE = path.join(DATA_DIR, 'streams.json');

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

const START_REQUEST_LOCK_TTL_MS = 30_000;
const STALE_START_TIMEOUT_MS = 30_000 // 30 seconds - same as lock TTL, can be configured separately
const ACTIVE_STREAM_STATUSES = new Set(['queued', 'starting', 'live', 'reconnecting', 'stopping']);
const ACTIVE_JOB_STATES = new Set(['active', 'wait', 'waiting', 'delayed', 'paused', 'waiting-children', 'prioritized']);
const TERMINAL_JOB_STATES = new Set(['completed', 'failed']);

export function getStreamStartJobId(streamId) {
  return `stream-start-${streamId}`;
}

async function findExistingJob(queue, streamId, deterministicJobId) {
  const deterministicJob = await queue.getJob(deterministicJobId);
  if (deterministicJob) return deterministicJob;

  // Find timestamp-ID jobs created by the previous API implementation while
  // they are still active/queued, so rollout does not duplicate those starts.
  const jobs = await queue.getJobs(['active', 'wait', 'waiting', 'delayed', 'paused', 'waiting-children', 'prioritized'], 0, -1);
  return jobs.find((job) => job.name === 'start-stream' && job.data?.streamId === streamId) || null;
}

/**
 * Atomically serialize start requests across API replicas. All callbacks that
 * read/update the persisted stream record run while the Redis token lease is held.
 */
export async function enqueueStreamStart({
  redis,
  queue,
  streamId,
  getStream,
  getSubscriptionTier,
  markStarting,
}) {
   // Check for stale "starting" state - if stream has been starting for too long,
  const stream = await getStream();
  if (stream && stream.status === 'starting') {
      const startedAt = stream.updated_at ? new Date(stream.updated_at).getTime() : 0;
      const now = Date.now();
      const age = now - startedAt;
      if (age > STALE_START_TIMEOUT_MS) {
        // Reset the status to allow a new start attempt
        // Update the authoritative JSON store (same as API endpoints and markStarting use)
        try {
          const streams = readJsonFile(STREAMS_FILE, []);
          const index = streams.findIndex((s) => s.id === streamId);
          if (index !== -1) {
            streams[index].status = 'idle';
            streams[index].updated_at = new Date().toISOString();
            // Preserve last_started_at if it exists, otherwise set to current time
            if (streams[index].last_started_at) {
              streams[index].last_started_at = new Date(streams[index].last_started_at).toISOString();
            } else {
              streams[index].last_started_at = new Date().toISOString();
            }
            writeJsonFile(STREAMS_FILE, streams);
            console.log(`[streamStart] Reset stale starting state for stream ${streamId} (age: ${age}ms)`);
          }
        } catch (e) {
          console.warn(`[streamStart] Failed to reset stale state for ${streamId}:`, e);
        }
      }
    }
  }
  const lockKey = `streempulse:start-request:${streamId}`;
  const result = await withRedisLease(redis, lockKey, async () => {
    const stream = await getStream();
if (stream && stream.status === 'starting') {
      const startedAt = stream.updated_at ? new Date(stream.updated_at).getTime() : 0;
      const now = Date.now();
      const age = now - startedAt;
      if (age > STALE_START_TIMEOUT_MS) {
        // Reset the status to allow a new start attempt
        // Update the authoritative JSON store (same as API endpoints and markStarting use)
        try {
          const streams = readJsonFile(STREAMS_FILE, []);
          const index = streams.findIndex((s) => s.id === streamId);
          if (index !== -1) {
            streams[index].status = 'idle';
            streams[index].updated_at = new Date().toISOString();
            // Preserve last_started_at if it exists, otherwise set to current time
            if (streams[index].last_started_at) {
              streams[index].last_started_at = new Date(streams[index].last_started_at).toISOString();
            } else {
              streams[index].last_started_at = new Date().toISOString();
            }
            writeJsonFile(STREAMS_FILE, streams);
            console.log(`[streamStart] Reset stale starting state for stream ${streamId} (age: ${age}ms)`);
          }
        } catch (e) {
          console.warn(`[streamStart] Failed to reset stale state for ${streamId}:`, e);
        }
      }
    }
    if (!stream) return { kind: 'not-found' };
    if (!stream.video_url || !stream.stream_key) return { kind: 'invalid-stream' };

    if (ACTIVE_STREAM_STATUSES.has(String(stream.status).toLowerCase())) {
      return { kind: 'already-running', status: stream.status };
    }

    const jobId = getStreamStartJobId(streamId);
    const existingJob = await findExistingJob(queue, streamId, jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (ACTIVE_JOB_STATES.has(state)) {
        await markStarting(stream);
        return { kind: 'already-queued', jobId: existingJob.id, state };
      }
      if (TERMINAL_JOB_STATES.has(state)) {
        await existingJob.remove();
      } else {
        // Unknown/transition state is treated as occupied rather than risking a duplicate.
        return { kind: 'already-queued', jobId: existingJob.id, state };
      }
    }

    const job = await queue.add('start-stream', {
      streamId: stream.id,
      videoUrl: stream.video_url,
      streamKey: stream.stream_key,
      rtmpServerUrl: stream.rtmp_server_url,
      destinations: stream.destinations,
      subscriptionTier: await getSubscriptionTier(stream),
      orientation: stream.orientation,
      directCopyMode: stream.direct_copy_mode,
      isLooping: stream.is_looping,
    }, { jobId });

    await markStarting(stream);
    return { kind: 'started', jobId: job.id };
  }, { ttlMs: START_REQUEST_LOCK_TTL_MS, renewIntervalMs: 5_000 });

  if (!result.acquired) return { kind: 'request-in-progress' };
  return result.value;
}
