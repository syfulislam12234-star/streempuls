import { withRedisLease } from './redisLease.js';
import { reconcileUserStreamsForStart } from './streamOwnership.js';
import { countActiveStreams } from './streamQuota.js';
import { getSignedStorageUrl } from './supabase.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const STREAMS_FILE = path.join(DATA_DIR, 'streams.json');
const UPLOADED_ASSETS_FILE = path.join(DATA_DIR, 'uploaded_assets.json');

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function readUploadedAssets() {
  const assets = readJsonFile(UPLOADED_ASSETS_FILE, []);
  return Array.isArray(assets) ? assets : [];
}

function normalizeAssetKeyForUrl(videoUrl) {
  if (!videoUrl) return '';
  try {
    const url = new URL(videoUrl);
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return videoUrl.replace(/^\/+/, '');
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
  authorizeStream = async () => true,
  ensureStreamRecord = async () => {},
  database,
  userId,
  planMaxStreams,
}) {
  const lockKey = `streempulse:start-request:${streamId}`;
  const result = await withRedisLease(redis, lockKey, async () => {
    const stream = await getStream();
    if (!stream) return { kind: 'not-found' };
    if (!await authorizeStream(stream)) return { kind: 'not-found' };

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
            stream.status = 'idle';
            stream.updated_at = streams[index].updated_at;
            console.log(`[streamStart] Reset stale starting state for stream ${streamId} (age: ${age}ms)`);
          }
        } catch (e) {
          console.warn(`[streamStart] Failed to reset stale state for ${streamId}:`, e);
        }
      }
    }
    if (!stream.video_url || !stream.stream_key) return { kind: 'invalid-stream' };

    // -----------------------------------------------------------------------
    // Video readiness gate: live streaming is stream-copy (-c copy) only.
    // A video may go live only after upload-time normalization has finished
    // and the normalized object exists in storage. Otherwise the stream is
    // refused with video_not_ready so the UI shows a "Processing" state.
    // -----------------------------------------------------------------------
    const assets = readUploadedAssets();
    const assetKey = normalizeAssetKeyForUrl(stream.video_url);
    const asset = assets.find(
      (a) => (assetKey && a.key === assetKey) || a.url === stream.video_url || a.publicUrl === stream.video_url
    );
    let startVideoUrl = stream.video_url;
    if (asset) {
      if (asset.normalization_status !== 'ready') {
        return {
          kind: 'video_not_ready',
          status: 'needs_processing',
          reason: asset.normalization_status || 'pending',
          error: asset.normalization_error || null,
          normalized: Boolean(asset.normalized),
          normalized_object_key: asset.normalized_object_key || null,
        };
      }
      if (asset.normalized_object_key) {
        try {
          // Stream exclusively from the normalized object; keep the existing
          // R2/Supabase -> local cache -> FFmpeg input flow in the worker.
          startVideoUrl = await getSignedStorageUrl(asset.normalized_object_key, 3600);
        } catch {
          // If signing fails, keep the original URL; the worker's pre-flight
          // probe will still refuse any input that is not normalized.
          startVideoUrl = stream.video_url;
        }
      }
    }

    if (ACTIVE_STREAM_STATUSES.has(String(stream.status).toLowerCase())) {
      return { kind: 'already-running', status: stream.status };
    }

    // --- Cleanup: clear stale/stopped records for this user in Supabase ---
    // Prevents split ownership and distributed stream lock loss when a user
    // has leftover records from crashed or previously stopped broadcasts.
    if (database && typeof userId === 'string' && userId) {
      const now = Date.now();
      await reconcileUserStreamsForStart(database, {
        userId,
        exceptStreamId: streamId,
        now,
      });
    }

    // --- Plan limit: count the user's fresh active streams (excluding this one) ---
    const planLimit = typeof planMaxStreams === 'number' && Number.isFinite(planMaxStreams)
      ? planMaxStreams
      : Infinity;
    if (database && typeof userId === 'string' && userId && planLimit !== Infinity) {
      const { data: activeRows, error: activeError } = await database
        .from('streams')
        .select('id,last_heartbeat')
        .eq('user_id', userId)
        .neq('id', streamId)
        .in('status', ['queued', 'starting', 'live', 'reconnecting']);
      if (activeError) throw activeError;

      const now = Date.now();
      const activeCount = (Array.isArray(activeRows) ? activeRows : []).filter((row) => {
        const ts = typeof row.last_heartbeat === 'string' ? Date.parse(row.last_heartbeat) : null;
        return ts !== null && ts >= now - 30_000;
      }).length;

      if (activeCount >= planLimit) {
        return {
          kind: 'plan-limit-exceeded',
          activeCount,
          planMaxStreams: planLimit,
        };
      }
    }

    // The API's local stream catalog and the worker's Supabase ownership
    // record must both exist before a job can be consumed by the worker.
    await ensureStreamRecord(stream);

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
      videoUrl: startVideoUrl,
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
