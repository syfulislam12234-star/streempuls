import { withRedisLease } from './redisLease.js';

const START_REQUEST_LOCK_TTL_MS = 30_000;
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
  const lockKey = `streempulse:start-request:${streamId}`;
  const result = await withRedisLease(redis, lockKey, async () => {
    const stream = await getStream();
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
