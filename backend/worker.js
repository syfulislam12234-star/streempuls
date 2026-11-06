/**
 * ============================================================================
 * StreamPulse - Fault-Tolerant 24/7 YouTube Streaming Worker Engine
 * Stack: Node.js 22 + BullMQ + ioredis + Supabase + FFmpeg Direct Copy
 * Architecture: Isolated Worker Node (stream-worker-node)
 * ============================================================================
 * 
 * Key Architectural Highlights:
 * 1. Strict Per-Container Capacity: Enforces MAX_CONCURRENT_STREAMS = 10.
 *    Any extra jobs remain in BullMQ queue for sibling worker nodes.
 * 2. Process Isolation Registry: Per-stream child process tracking prevents
 *    cross-stream crashes when an individual stream fails or stops.
 * 3. Resource & Memory Watchdog: Monitors CPU & RSS memory against container
 *    cgroup boundaries (2GB limit) and prevents OOM crashes.
 * 4. Modular Storage Integration: Streams from Supabase Storage ('stream-assets')
 *    by default with switchable S3-compatible Cloudflare R2 fallback.
 * 5. High-Availability Auto-Recovery: Backoff watchdogs, process telemetry,
 *    and graceful teardown with Docker HEALTHCHECK integration.
 */

import { Worker } from 'bullmq';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { redisConfig, redisClient, QUEUE_NAME } from './queue.js';
import { supabase, SUPABASE_STORAGE_BUCKET, STORAGE_PROVIDER, getPublicStorageUrl, getSignedStorageUrl } from './supabase.js';
import { getStorageProvider } from './storage.js';
import { parseR2ObjectUrl, normalizeR2ObjectKey } from './r2ObjectUrl.js';
import { buildStreamDestinations } from './streamDestinations.js';
import { runWithStreamLease } from './streamLeaseRunner.js';
import { extractFfmpegErrorLines, sanitizeChildProcessError, sanitizeFfmpegDiagnostic } from './streamDiagnostics.js';
import { claimStreamOwnership, updateStreamWhenOwned } from './streamOwnership.js';
import { cleanupOrphanedVideoCacheFiles, acquireVideoCache, getVideoCacheStats } from './videoCache.js';
import { stopStreamsThenClose } from './workerShutdown.js';
import { terminateChildAndWait, terminateChildAndReleaseCache, scheduleRestartAfterExit } from './ffmpegLifecycle.js';
import { getCacheFallbackReason, retryCachePreparation } from './cacheFallback.js';
import { downloadVideoToLocalFile, resolveLocalUpload } from './localVideoSource.js';
import { directCopyIneligibility, parseFfmpegProgressRecord, probeFfmpegVideoMetadata, readProcessMemoryMb, sampleProcessCpuPercent } from './ffmpegProgress.js';

dotenv.config();
const DIRECT_COPY_ENABLED = process.env.DIRECT_COPY_ENABLED !== 'false';

// ----------------------------------------------------------------------------
// Worker Node Identity & Capacity Configuration
// ----------------------------------------------------------------------------
export const WORKER_NODE_ID = process.env.WORKER_NODE_ID || 'worker-node-' + process.pid;
export const MAX_CONCURRENT_STREAMS = parseInt(process.env.MAX_CONCURRENT_STREAMS || '10', 10);
export const MAX_RESTART_RETRIES = parseInt(process.env.MAX_RESTART_RETRIES || '5', 10);
const BASE_RECONNECT_DELAY_MS = 3000; // 3-second base exponential backoff
const DEFAULT_CONCURRENCY = Math.min(parseInt(process.env.WORKER_CONCURRENCY || '10', 10), MAX_CONCURRENT_STREAMS);
let currentConcurrency = DEFAULT_CONCURRENCY;

const HEARTBEAT_FILE = path.resolve('/tmp/worker-heartbeat.json');
const DEFAULT_UPLOADS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../uploads');
const MEMORY_CEILING_MB = parseInt(process.env.MEMORY_CEILING_MB || '1850', 10); // Hard limit 2048MB, soft cycle at 1850MB
const CONTAINER_HARD_MEMORY_LIMIT_MB = 2048;

console.log('====================================================================');
console.log('[StreamPulse Worker] Node ID: ' + WORKER_NODE_ID);
console.log('[StreamPulse Worker] Queue: "' + QUEUE_NAME + '"');
console.log('[StreamPulse Worker] Hard Limit: MAX ' + MAX_CONCURRENT_STREAMS + ' concurrent streams per container');
var reconnectDelaySecs = BASE_RECONNECT_DELAY_MS / 1000;
console.log('[StreamPulse Worker] Auto-Recovery: MAX ' + MAX_RESTART_RETRIES + ' retries with ' + reconnectDelaySecs + 's exponential backoff');
console.log('[StreamPulse Worker] Zero-Lag Stream Pacing: -fflags nobuffer, -flags low_delay, -rtbufsize 1024M, -muxdelay 0.1');
console.log('[StreamPulse Worker] Storage Provider: ' + STORAGE_PROVIDER.toUpperCase() + ' (Bucket: ' + SUPABASE_STORAGE_BUCKET + ')');
console.log('====================================================================');

// ----------------------------------------------------------------------------
// 1. Process Registry: Isolated Stream Tracking
// Maps streamId -> streamController
// Guarantees stopping or crashing one stream NEVER drops concurrent sibling streams!
// ----------------------------------------------------------------------------
const activeStreams = new Map();
const pendingStreamStarts = new Map();
const SIGNED_SOURCE_URL_TTL_MS = 24 * 60 * 60 * 1000;
const SIGNED_SOURCE_REFRESH_SKEW_MS = 5 * 60 * 1000;
const MAX_FFMPEG_DIAGNOSTICS = 12;

function terminateFfmpegChild(child, gracePeriodMs = 5000) {
  return terminateChildAndWait(child, { gracePeriodMs });
}

function redactUrlQuery(value) {
  try {
    new URL(value);
    return '[REMOTE VIDEO SOURCE REDACTED]';
  } catch {
    return value;
  }
}

function probeDirectCopyEligibility(source) {
  return probeFfmpegVideoMetadata(source)
    .then((metadata) => {
      const reason = directCopyIneligibility(metadata);
      return { eligible: !reason, reason, metadata };
    })
    .catch((error) => ({ eligible: false, reason: error?.message?.includes('timed out') ? 'ffprobe-timeout' : 'ffprobe-error', metadata: null }));
}

/**
 * Gracefully terminates the exact FFmpeg child process associated with streamId.
 * Sets isIntentionalStop = true to prevent auto-recovery loop from restarting.
 * Uses SIGTERM initially, with a 5-second fallback to SIGKILL if stubborn.
 */
export async function stopStreamProcess(streamId, reason = 'User requested stop') {
  const streamInstance = activeStreams.get(streamId);

  if (!streamInstance) {
    const pendingStart = pendingStreamStarts.get(streamId);
    if (pendingStart) {
      pendingStart.abortController.abort();
      console.log('[Process Tracker] Cancelled pending start for stream ' + streamId + ' on worker node ' + WORKER_NODE_ID + '.');
      return true;
    }
    console.log('[Process Tracker] Stream ' + streamId + ' not running on worker node ' + WORKER_NODE_ID + '.');
    return false;
  }

  console.log('[Process Tracker] Terminating stream ' + streamId + ' (Reason: ' + reason + ')');
  streamInstance.isIntentionalStop = true;

  if (typeof streamInstance.stop === 'function') {
    return await streamInstance.stop(reason);
  }

  const { child, pid } = streamInstance;
  return new Promise((resolve) => {
    const forceKillTimer = setTimeout(() => {
      try {
        console.warn('[Process Tracker] Stream ' + streamId + ' PID ' + pid + ' did not exit in 5s. Sending SIGKILL.');
        child?.kill('SIGKILL');
      } catch (err) {}
    }, 5000);

    child?.once('exit', () => {
      clearTimeout(forceKillTimer);
      activeStreams.delete(streamId);
      console.log('[Process Tracker] Stream ' + streamId + ' stopped. Remaining active: ' + activeStreams.size + '/' + MAX_CONCURRENT_STREAMS);
      resolve(true);
    });

    try {
      child?.kill('SIGTERM');
    } catch (err) {
      clearTimeout(forceKillTimer);
      activeStreams.delete(streamId);
      resolve(false);
    }
  });
}

// ----------------------------------------------------------------------------
// 2. FFmpeg Isolated Spawn Engine with Autonomous Auto-Recovery & Zero-Lag Flags
// ----------------------------------------------------------------------------
async function launchFfmpegStream(job, lease, abortSignal) {
  const { streamId, videoUrl, streamKey, rtmpServerUrl, destinations, subscriptionTier, orientation, directCopyMode } = job.data;

  // Container Overload Load-Balancing & Failover (Auto-Shift):
  // When a worker container reaches 10 active streams, route new stream requests dynamically
  // to the next available idle worker node via BullMQ failover.
  if (activeStreams.size >= MAX_CONCURRENT_STREAMS) {
    var overloadNotice = '[Container Overload Auto-Shift] Worker container ' + WORKER_NODE_ID + ' saturated (' + activeStreams.size + '/' + MAX_CONCURRENT_STREAMS + '). Auto-shifting stream ' + streamId + ' to next idle worker node...';
    console.warn(overloadNotice);
    throw new Error('CONTAINER_OVERLOAD: ' + overloadNotice);
  }
  if (activeStreams.has(streamId)) {
    throw new Error('This worker already owns a process for the requested stream.');
  }
  const ownershipToken = lease?.token;
  if (typeof ownershipToken !== 'string' || !ownershipToken) {
    throw new Error('A distributed ownership token is required before FFmpeg can start.');
  }

  // Build each output from its own server/key pair exactly once. Existing
  // secondary destinations use the FFmpeg tee for concurrent output, not failover.
  const activeDestinations = buildStreamDestinations({
    rtmpServerUrl,
    streamKey,
    destinations,
    subscriptionTier,
  });

  // Resolve video source from active modular storage adapter (Supabase or switchable R2)
  let inputSource = videoUrl;
  let signedUrlGeneratedAt = null;
  let signedUrlTtlMs = null;
  let refreshSignedInputSource = null;
  let r2SourceToCache = null;
  let r2CachedMetadata = null;
  let r2CacheAttempted = false;
  let cachedR2SourceLease = null;
  const streamStartController = new AbortController();
  const sensitiveValues = [streamKey, ...(Array.isArray(destinations) ? destinations.map((destination) => destination?.streamKey) : [])];
  if (videoUrl && !videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
    // Resolve API-facing /uploads URLs against this worker's configured local
    // directory; preserve other absolute paths for existing deployments.
    if (videoUrl.startsWith('/')) {
      inputSource = resolveLocalUpload(
        videoUrl,
        process.env.UPLOADS_DIR || DEFAULT_UPLOADS_DIR,
      ) || videoUrl;
    } else {
      const r2Provider = STORAGE_PROVIDER === 'r2' ? getStorageProvider('r2') : null;
      const cleanPath = r2Provider
        ? normalizeR2ObjectKey(videoUrl, r2Provider.bucket)
        : videoUrl.replace(/^(stream-assets|live-stream-assets)\//, '').replace(/^\/+/, '');
      if (r2Provider) {
        const metadata = await r2Provider.headObject(cleanPath);
        r2SourceToCache = {
          provider: r2Provider,
          objectKey: cleanPath,
          expectedBytes: Number(metadata.ContentLength),
          etag: metadata.ETag || null,
          lastModified: metadata.LastModified instanceof Date ? metadata.LastModified.toISOString() : null,
        };
        inputSource = '[R2 source will be cached locally]';
      } else {
        let signedUrl = null;
        try {
          signedUrl = await getSignedStorageUrl(cleanPath);
        } catch {
          console.warn('[FFmpeg Engine] Storage URL signing failed for stream ' + streamId);
        }
        inputSource = signedUrl || getPublicStorageUrl(cleanPath);
        if (signedUrl) {
          const provider = getStorageProvider(STORAGE_PROVIDER);
          refreshSignedInputSource = () => provider.getSignedUrl(cleanPath, SIGNED_SOURCE_URL_TTL_MS / 1000);
          signedUrlGeneratedAt = Date.now();
          signedUrlTtlMs = SIGNED_SOURCE_URL_TTL_MS;
        }
      }
    }
  } else if (typeof videoUrl === 'string' && /^https?:\/\//i.test(videoUrl)) {
    let identifiedR2Source = false;
    try {
      const parsedUrl = new URL(videoUrl);
      const r2Provider = getStorageProvider('r2');
      const r2Object = parseR2ObjectUrl(videoUrl, {
        bucket: r2Provider.bucket,
        endpoint: r2Provider.endpoint,
        publicDomain: r2Provider.publicDomain,
      });
      identifiedR2Source = Boolean(r2Object);
      const pathname = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''));
      const supabaseStorageMatch = pathname.match(/^storage\/v1\/object\/(?:public|sign|authenticated)\/[^/]+\/(.+)$/);
      const isSupabaseStorageUrl = parsedUrl.hostname.includes('supabase.co') && Boolean(supabaseStorageMatch);
      if (r2Object || isSupabaseStorageUrl) {
        const isR2Url = Boolean(r2Object);
        const objectKey = isR2Url ? r2Object.key : supabaseStorageMatch[1];
        const provider = isR2Url ? r2Provider : getStorageProvider('supabase');
        if (isR2Url) {
          const metadata = await provider.headObject(objectKey);
          r2SourceToCache = {
            provider,
            objectKey,
            expectedBytes: Number(metadata.ContentLength),
            etag: metadata.ETag || null,
            lastModified: metadata.LastModified instanceof Date ? metadata.LastModified.toISOString() : null,
          };
          inputSource = '[R2 source will be cached locally]';
        } else {
          const signedUrl = await provider.getSignedUrl(objectKey, SIGNED_SOURCE_URL_TTL_MS / 1000);
          if (signedUrl && signedUrl !== videoUrl) {
            inputSource = signedUrl;
            refreshSignedInputSource = () => provider.getSignedUrl(objectKey, SIGNED_SOURCE_URL_TTL_MS / 1000);
            signedUrlGeneratedAt = Date.now();
            signedUrlTtlMs = SIGNED_SOURCE_URL_TTL_MS;
          }
        }
      }
    } catch {
      if (identifiedR2Source) {
        throw new Error('R2 video could not be prepared for local worker storage.');
      }
      console.warn('[FFmpeg Engine] Remote video source could not be resolved for stream ' + streamId);
    }
  }

  if (lease?.lost) {
    throw new Error('Distributed stream lock was lost before FFmpeg startup.');
  }
  if (abortSignal?.aborted) return;

  const claimTimestamp = new Date().toISOString();
  const claimed = await claimStreamOwnership(supabase, {
    streamId,
    token: ownershipToken,
    updates: {
      status: 'starting',
      ffmpeg_pid: null,
      last_heartbeat: claimTimestamp,
      last_error: null,
      updated_at: claimTimestamp,
    },
  });
  if (!claimed) {
    throw new Error('The stream is owned by another runtime or has a current heartbeat.');
  }

  return new Promise((resolve, reject) => {
    let reconnectAttempts = 0;
    let currentChild = null;
    let reconnectTimeout = null;
    let isTerminated = false;
    let ffmpegStartSequence = 0;
    let telemetryUpdateCount = 0;
    let telemetrySequence = 0;
    let copyFallbackAttempted = false;
    let forceTranscode = false;
    const isVertical = orientation === 'vertical';
    const recentFfmpegDiagnostics = [];
    let leaseLostError = null;
    let leaseLossHandled = false;
    let heartbeatTimer = null;
    let progressWatchdogTimer = null;
    let cacheTelemetry = { cache_status: r2SourceToCache ? 'pending' : 'local-or-remote' };
    const releaseCachedR2Source = async () => {
      const cacheLease = cachedR2SourceLease;
      cachedR2SourceLease = null;
      if (cacheLease) await cacheLease.release().catch(() => {});
    };
    const terminateAndReleaseCachedSource = async (child) => {
      return terminateChildAndReleaseCache(child, releaseCachedR2Source);
    };
    const publishTelemetry = async (payload) => {
      try {
        const message = JSON.stringify(payload);
        await redisClient.publish(`stream:telemetry:${streamId}`, message);
        await redisClient.publish('stream-telemetry-events', message);
      } catch {}
    };
    const handleAbort = () => {
      streamStartController.abort();
      void streamController.stop('Start cancelled before broadcast');
    };
    const updateOwnedStream = (updates, release = false) => updateStreamWhenOwned(supabase, {
      streamId,
      token: ownershipToken,
      updates,
      release,
    });

  console.log("[FFmpeg Engine] Preparing stream " + streamId + " | Destinations: " + activeDestinations.length);
  console.log("[FFmpeg Engine] Source: " + redactUrlQuery(inputSource) + " | Vertical: " + isVertical + " | DirectCopy: " + (directCopyMode !== false));

    // Stream Controller registered in activeStreams
    const streamController = {
      streamId,
      job,
      startedAt: new Date(),
      destinationsCount: activeDestinations.length,
      get child() { return currentChild; },
      get pid() { return currentChild?.pid || null; },
      get reconnectAttempts() { return reconnectAttempts; },
      isIntentionalStop: false,
      stop: async (reason = 'User requested stop') => {
        isTerminated = true;
        streamController.isIntentionalStop = true;
        streamStartController.abort();
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }

        const childStopped = await terminateAndReleaseCachedSource(currentChild);
        if (!childStopped) {
          console.error('[Process Tracker] Could not confirm FFmpeg exit for stream ' + streamId + '; retaining ownership until the child exits.');
          return false;
        }
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        if (progressWatchdogTimer) { clearInterval(progressWatchdogTimer); progressWatchdogTimer = null; }
        activeStreams.delete(streamId);

        const released = await updateOwnedStream({
          status: 'idle',
          ffmpeg_pid: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        }, true).catch(() => false);
        if (!released && !leaseLostError) {
          await handleLeaseLoss(new Error('Distributed stream ownership was lost while stopping.'));
          return false;
        }

        console.log("[Process Tracker] Stream " + streamId + " cleanly stopped ( " + reason + " ). Active: " + activeStreams.size + " / " + MAX_CONCURRENT_STREAMS);
        if (leaseLostError) reject(new Error('Distributed stream lock was lost; FFmpeg was stopped.'));
        else resolve(true);
      },
    };

    abortSignal?.addEventListener('abort', handleAbort, { once: true });
    if (abortSignal?.aborted) handleAbort();

    const handleLeaseLoss = async (error) => {
      if (leaseLossHandled) return;
      leaseLossHandled = true;
      leaseLostError = error || new Error('Distributed stream lock was lost.');
      isTerminated = true;
      streamStartController.abort();
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      streamController.isIntentionalStop = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      const childStopped = await terminateAndReleaseCachedSource(currentChild);
      if (!childStopped && currentChild) {
        const child = currentChild;
        let finalized = false;
        const retainClaimHeartbeat = setInterval(() => {
          if (child.exitCode != null || child.signalCode != null) return;
          const now = new Date().toISOString();
          void updateOwnedStream({ last_heartbeat: now, updated_at: now }).catch(() => {});
        }, 5000);
        retainClaimHeartbeat.unref?.();
        const finalizeAfterChildExit = async () => {
          if (finalized) return;
          finalized = true;
          clearInterval(retainClaimHeartbeat);
          if (progressWatchdogTimer) { clearInterval(progressWatchdogTimer); progressWatchdogTimer = null; }
          activeStreams.delete(streamId);
          abortSignal?.removeEventListener('abort', handleAbort);
          try {
            await updateOwnedStream({
              status: 'ERROR',
              ffmpeg_pid: null,
              last_error: 'Distributed stream lock was lost; FFmpeg was stopped to avoid split ownership.',
              updated_at: new Date().toISOString(),
            }, true);
          } catch {}
          await releaseCachedR2Source();
          reject(new Error('Distributed stream lock was lost; FFmpeg was stopped to avoid split ownership.'));
        };
        child.once('exit', () => { void finalizeAfterChildExit(); });
        child.once('close', () => { void finalizeAfterChildExit(); });
        if (child.exitCode != null || child.signalCode != null) void finalizeAfterChildExit();
        console.error('[Process Tracker] Distributed lease was lost, but FFmpeg exit is unconfirmed; retaining the database claim until the child exits.');
        return;
      }
      if (progressWatchdogTimer) { clearInterval(progressWatchdogTimer); progressWatchdogTimer = null; }
      activeStreams.delete(streamId);
      const safeError = 'Distributed stream lock was lost; FFmpeg was stopped to avoid split ownership.';
      try {
        await updateOwnedStream({
          status: 'ERROR',
          ffmpeg_pid: null,
          last_error: safeError,
          updated_at: new Date().toISOString(),
        }, true);
      } catch {}
      try {
        await releaseStreamLockAndReset(streamId, 'idle');
      } catch {}
      reject(new Error(safeError));
    };

    lease?.onLost(handleLeaseLoss);
    if (lease?.lost) {
      void handleLeaseLoss(new Error('Distributed stream lock was lost.'));
    }

    activeStreams.set(streamId, streamController);
    // Record the Redis lease token so shutdown/cleanup can release the lock
    // only if this process still owns it (fenced delete, no lock theft).
    streamController.leaseToken = lease?.token || null;

    // Spawns FFmpeg with Zero-Lag and Low-Latency configuration
    async function startFfmpegProcess() {
      if (isTerminated || streamController.isIntentionalStop) {
        abortSignal?.removeEventListener('abort', handleAbort);
        if (leaseLostError) reject(new Error('Distributed stream lock was lost; FFmpeg was stopped.'));
        else resolve();
        return;
      }

      if (r2SourceToCache && !cachedR2SourceLease && !r2CacheAttempted) {
        r2CacheAttempted = true;
        const cacheDir = process.env.VIDEO_CACHE_DIR || path.join(os.tmpdir(), 'streempulse-video-cache');
        const expectedBytes = r2SourceToCache.expectedBytes;
        const maxFileBytes = Number(process.env.VIDEO_CACHE_MAX_FILE_BYTES) || 5_000_000_000;
        const minFreeBytes = Number(process.env.VIDEO_CACHE_MIN_FREE_BYTES) || 1024 * 1024 * 1024;
        try { await cleanupOrphanedVideoCacheFiles(cacheDir, { redis: redisClient }); } catch {}

        const sourceVersionKnown = Boolean(r2SourceToCache.etag || r2SourceToCache.lastModified);
        const cachePreparation = await retryCachePreparation({
          attempts: sourceVersionKnown ? 2 : 0,
          shouldAbort: () => streamStartController.signal.aborted || Boolean(lease?.lost),
          prepare: async () => {
            const signedUrl = await r2SourceToCache.provider.getSignedUrl(
              r2SourceToCache.objectKey,
              SIGNED_SOURCE_URL_TTL_MS / 1000,
            );
            if (!signedUrl) throw new Error('Storage URL unavailable.');
            let lastProgressAt = 0;
            let lastProgressBytes = 0;
            let lastProgressTime = Date.now();
            return acquireVideoCache({
              redis: redisClient,
              cacheDir,
              identity: {
                provider: 'r2',
                bucket: r2SourceToCache.provider.bucket,
                objectKey: r2SourceToCache.objectKey,
                etag: r2SourceToCache.etag,
                lastModified: r2SourceToCache.lastModified,
                expectedBytes,
              },
              expectedBytes,
              maxFileBytes,
              minFreeBytes,
              signal: streamStartController.signal,
              verify: probeFfmpegVideoMetadata,
              onProgress: (receivedBytes, totalBytes) => {
                const now = Date.now();
                if (now - lastProgressAt < 1000) return;
                const elapsedSeconds = Math.max((now - lastProgressTime) / 1000, 0.001);
                const downloadMbps = ((receivedBytes - lastProgressBytes) * 8) / elapsedSeconds / 1_000_000;
                lastProgressAt = now;
                lastProgressBytes = receivedBytes;
                lastProgressTime = now;
                cacheTelemetry = {
                  cache_status: 'downloading',
                  cache_bytes_downloaded: receivedBytes,
                  cache_total_bytes: totalBytes || expectedBytes,
                  cache_progress_pct: totalBytes || expectedBytes
                    ? Math.min(100, (receivedBytes / (totalBytes || expectedBytes)) * 100)
                    : null,
                  input_download_mbps: +downloadMbps.toFixed(2),
                };
                void publishTelemetry({ streamId, ...cacheTelemetry, timestamp: new Date().toISOString() });
              },
              download: (destinationPath, { signal, onProgress }) => downloadVideoToLocalFile(
                signedUrl,
                destinationPath,
                { expectedBytes, maxBytes: maxFileBytes, signal, onProgress },
              ),
            });
          },
        });
        const cachedVideo = cachePreparation.value;
        if (cachePreparation.cancelled) {
          await cachedVideo?.release();
          return;
        }

        if (cachedVideo) {
          cachedR2SourceLease = cachedVideo;
          r2CachedMetadata = cachedVideo.mediaMetadata;
          inputSource = cachedVideo.path;
          const cacheStats = await getVideoCacheStats(cacheDir).catch(() => ({}));
          cacheTelemetry = {
            cache_status: cachedVideo.cacheHit ? 'hit' : 'ready',
            cache_progress_pct: 100,
            cache_bytes_downloaded: cachedVideo.sizeBytes,
            cache_total_bytes: cachedVideo.sizeBytes,
            input_download_mbps: cachedVideo.cacheHit ? 0 : cacheTelemetry.input_download_mbps,
            cache_disk_total_bytes: cacheStats.diskTotalBytes ?? null,
            cache_disk_available_bytes: cacheStats.diskAvailableBytes ?? null,
            cache_disk_used_bytes: cacheStats.diskTotalBytes != null && cacheStats.diskAvailableBytes != null
              ? cacheStats.diskTotalBytes - cacheStats.diskAvailableBytes
              : null,
            cache_used_bytes: cacheStats.cachedVideoBytes ?? null,
            cache_video_count: cacheStats.cachedVideoCount ?? null,
            cached_video_width: cachedVideo.mediaMetadata?.width ?? null,
            cached_video_height: cachedVideo.mediaMetadata?.height ?? null,
            cached_video_codec: cachedVideo.mediaMetadata?.codecName ?? null,
          };
          console.log('[Video Cache] ' + (cachedVideo.cacheHit ? 'hit' : 'created') + ' for stream ' + streamId);
        } else {
          try {
            const fallbackUrl = await r2SourceToCache.provider.getSignedUrl(
              r2SourceToCache.objectKey,
              SIGNED_SOURCE_URL_TTL_MS / 1000,
            );
            if (!fallbackUrl) throw new Error('Storage URL unavailable.');
            inputSource = fallbackUrl;
            refreshSignedInputSource = () => r2SourceToCache.provider.getSignedUrl(
              r2SourceToCache.objectKey,
              SIGNED_SOURCE_URL_TTL_MS / 1000,
            );
            signedUrlGeneratedAt = Date.now();
            signedUrlTtlMs = SIGNED_SOURCE_URL_TTL_MS;
            cacheTelemetry = {
              cache_status: 'direct-r2-fallback',
              cache_progress_pct: null,
              cache_fallback_reason: getCacheFallbackReason(sourceVersionKnown),
            };
            console.warn('[Video Cache] Local cache unavailable; using direct R2 input for stream ' + streamId);
          } catch {
            await handleProcessCrash(new Error('The video is unavailable in local storage and could not be opened from R2.'), null, null);
            return;
          }
        }
        void publishTelemetry({ streamId, ...cacheTelemetry, timestamp: new Date().toISOString() });
      }

      if (streamStartController.signal.aborted || isTerminated || streamController.isIntentionalStop) {
        await releaseCachedR2Source();
        return;
      }

      if (refreshSignedInputSource && signedUrlGeneratedAt && signedUrlTtlMs
        && Date.now() >= signedUrlGeneratedAt + signedUrlTtlMs - SIGNED_SOURCE_REFRESH_SKEW_MS) {
        try {
          const refreshedUrl = await refreshSignedInputSource();
          if (!refreshedUrl) throw new Error('Storage provider returned an empty signed source URL.');
          inputSource = refreshedUrl;
          signedUrlGeneratedAt = Date.now();
        } catch (error) {
          await handleProcessCrash(error, null, null);
          return;
        }
      }

      if (streamStartController.signal.aborted || isTerminated || streamController.isIntentionalStop) {
        await releaseCachedR2Source();
        return;
      }

      if (lease?.lost) {
        await handleLeaseLoss(new Error('Distributed stream lock was lost before FFmpeg startup.'));
        return;
      }

      console.log("[FFmpeg Spawn] Starting 24/7 stream: " + streamId + " (Attempt " + (reconnectAttempts + 1) + "/" + (MAX_RESTART_RETRIES + 1) + ")");

      // ------------------------------------------------------------------------
      // Zero-Lag & Low-Latency Stream Optimization Parameters
      // - -fflags nobuffer: Eliminates input demuxer caching latency
      // - -flags low_delay: Informs codec to output decoded packets immediately
      // - -rtbufsize 1024M: Generous real-time buffer to absorb network jitter
      // - -muxdelay 0.1: Minimizes muxing latency before RTMP dispatch
      // - -reconnect flags: Bulletproof HTTP/HTTPS reading for Cloudflare R2 / Supabase CDN
      // ------------------------------------------------------------------------
      const isHttpSource = inputSource.startsWith('http://') || inputSource.startsWith('https://');

      const ffmpegArgs = [
        '-re',
        '-stream_loop', '-1',
      ];

      // Cloudflare R2 / Supabase CDN auto-reconnect on socket drop:
      if (isHttpSource) {
        ffmpegArgs.push(
          '-reconnect', '1',
          '-reconnect_at_eof', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
          '-timeout', '15000000'
        );
      }

      ffmpegArgs.push(
        '-rtbufsize', '1024M',
        '-i', inputSource,
        '-fflags', '+nobuffer',
        '-flags', '+low_delay',
        '-muxdelay', '0.1',
        '-progress', 'pipe:1',
        '-nostats'
      );

      let copyEligibility = { eligible: false, reason: null, metadata: null };
      if (forceTranscode) {
        copyEligibility.reason = 'copy-fallback';
      } else if (directCopyMode === false) {
        copyEligibility.reason = 'direct-copy-mode-disabled';
      } else if (!DIRECT_COPY_ENABLED) {
        copyEligibility.reason = 'direct-copy-disabled-by-environment';
      } else {
        copyEligibility = r2CachedMetadata
          ? { eligible: !directCopyIneligibility(r2CachedMetadata), reason: directCopyIneligibility(r2CachedMetadata), metadata: r2CachedMetadata }
          : await probeDirectCopyEligibility(inputSource);
      }
      if (copyEligibility.eligible && copyEligibility.metadata
        && isVertical !== (copyEligibility.metadata.height > copyEligibility.metadata.width)) {
        copyEligibility.eligible = false;
        copyEligibility.reason = 'orientation-mismatch';
      }
      const useDirectCopy = copyEligibility.eligible && !forceTranscode;

      if (streamStartController.signal.aborted || isTerminated || streamController.isIntentionalStop) {
        await releaseCachedR2Source();
        return;
      }

      if (useDirectCopy) {
        ffmpegArgs.push(
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ar', '44100'
        );
      } else if (isVertical) {
        ffmpegArgs.push(
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-tune', 'zerolatency',
          '-b:v', '4500k',
          '-maxrate', '5000k',
          '-bufsize', '9000k',
          '-pix_fmt', 'yuv420p',
          '-g', '60',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ar', '44100'
        );
      } else {
        ffmpegArgs.push(
          '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-tune', 'zerolatency',
          '-b:v', '6000k',
          '-maxrate', '6500k',
          '-bufsize', '12000k',
          '-pix_fmt', 'yuv420p',
          '-g', '60',
          '-c:a', 'aac',
          '-b:a', '160k',
          '-ar', '44100'
        );
      }

      if (activeDestinations.length === 1) {
        ffmpegArgs.push(
          '-flvflags', 'no_duration_filesize',
          '-f', 'flv',
          activeDestinations[0]
        );
      } else {
        // Multi-destination tee muxer with onfail=ignore:
        // If one destination drops, other destinations remain streaming uninterrupted.
        const teeOutputString = activeDestinations
          .map((url) => "[f=flv:onfail=ignore]" + url)
          .join('|');

        ffmpegArgs.push(
          '-flags', '+global_header',
          '-f', 'tee',
          teeOutputString
        );
      }

      const currentProcessSequence = ++ffmpegStartSequence;
      telemetryUpdateCount = 0;
      telemetrySequence = 0;
      if (useDirectCopy) {
        console.log('[FFmpeg Mode] copy');
      } else {
        console.log('[FFmpeg Mode] transcode (' + (isVertical ? 'vertical' : 'landscape') + ') reason=' + copyEligibility.reason);
      }
      const attemptUsedDirectCopy = useDirectCopy;
      const attemptStartedAt = Date.now();
      let fallbackScheduled = false;
      let childErrorHandled = false;
      let progressBuffer = '';
      let progressRecord = [];
      let processCpuSample = null;
      let previousOutputTime = null;
      let previousProgressFrame = null;
      let lastOutputAdvanceAt = attemptStartedAt;
      let lastProgressMetricsWriteAt = 0;
      let previousDroppedFrames = 0;
      let stallRecoveryStarted = false;
      const startCopyFallback = () => {
        if (!attemptUsedDirectCopy || copyFallbackAttempted || rtmpConfirmed
          || streamController.isIntentionalStop || isTerminated) return false;
        copyFallbackAttempted = true;
        forceTranscode = true;
        fallbackScheduled = true;
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        if (progressWatchdogTimer) { clearInterval(progressWatchdogTimer); progressWatchdogTimer = null; }
        console.warn('[FFmpeg Mode] copy failed, falling back to transcode');
        void startFfmpegProcess();
        return true;
      };
      currentChild = spawn('ffmpeg', ffmpegArgs);
      const pid = currentChild.pid;

      currentChild.once('error', (err) => {
        if (childErrorHandled) return;
        childErrorHandled = true;
        const failedChild = currentChild;
        const safeError = sanitizeChildProcessError(err, { secrets: sensitiveValues });
        console.error('[FFmpeg Child Error] Stream ' + streamId + ': ' + safeError);
        let recoveryHandled = false;
        const recoverAfterExit = () => {
          if (recoveryHandled || (failedChild.exitCode == null && failedChild.signalCode == null)) return;
          recoveryHandled = true;
          if (!startCopyFallback()) return handleProcessCrash(err, null, null);
        };
        void terminateFfmpegChild(failedChild).then((stopped) => {
          if (stopped) recoverAfterExit();
          else {
            failedChild.once('exit', recoverAfterExit);
            if (failedChild.exitCode != null || failedChild.signalCode != null) recoverAfterExit();
          }
        });
      });

      if (!pid) {
        if (!childErrorHandled) {
          childErrorHandled = true;
          if (!startCopyFallback()) void handleProcessCrash(new Error('Failed to spawn FFmpeg child process'), null, null);
        }
        return;
      }

      console.log("[FFmpeg Spawn] Stream " + streamId + " active with PID " + pid + " (Attempts used: " + reconnectAttempts + "/" + MAX_RESTART_RETRIES + ")");

      // FFmpeg process spawned — but we do NOT mark 'live' yet.
      // Status becomes 'live' only after the first telemetry (bitrate/fps) confirms
      // that FFmpeg is actively sending data to the RTMP destination.
      try {
        const stillOwned = await updateOwnedStream({
          status: 'starting',
          ffmpeg_pid: pid,
          last_started_at: new Date().toISOString(),
          last_heartbeat: new Date().toISOString(),
          last_error: null,
          reconnect_attempts: reconnectAttempts,
          updated_at: new Date().toISOString(),
        });
        if (!stillOwned) {
          await handleLeaseLoss(new Error('Distributed stream ownership was lost before FFmpeg startup completed.'));
          return;
        }
      } catch {
        await handleLeaseLoss(new Error('Distributed stream ownership could not be verified before FFmpeg startup completed.'));
        return;
      }

      const progressWatchdogThresholdMs = Number(process.env.FFMPEG_PROGRESS_STALL_MS) || 30_000;
      progressWatchdogTimer = setInterval(() => {
        if (stallRecoveryStarted || isTerminated || streamController.isIntentionalStop) return;
        if (Date.now() - lastOutputAdvanceAt < progressWatchdogThresholdMs) return;
        stallRecoveryStarted = true;
        console.warn('[FFmpeg Watchdog] No advancing output progress for stream ' + streamId + '; restarting FFmpeg.');
        void terminateFfmpegChild(currentChild, 5000);
      }, 5000);
      progressWatchdogTimer.unref?.();

      let rtmpConfirmed = false;
      const processStartedAt = Date.now();
      const handleProgressRecord = async (record) => {
        if (currentProcessSequence !== ffmpegStartSequence || !record.trim()) return;
        const progress = parseFfmpegProgressRecord(record);
        const now = Date.now();
        const outputTimeAdvanced = progress.outputTimeSeconds !== null
          && (previousOutputTime === null || Math.abs(progress.outputTimeSeconds - previousOutputTime) > 0.001);
        const frameAdvanced = progress.frame !== null
          && (previousProgressFrame === null || progress.frame > previousProgressFrame);
        if (outputTimeAdvanced || frameAdvanced) {
          if (progress.outputTimeSeconds !== null) previousOutputTime = progress.outputTimeSeconds;
          if (progress.frame !== null) previousProgressFrame = progress.frame;
          lastOutputAdvanceAt = now;
          if (!rtmpConfirmed) telemetryUpdateCount++;
        }

        const cpuSample = await sampleProcessCpuPercent(pid, processCpuSample);
        processCpuSample = cpuSample.sample;
        const ffmpegMemoryMb = await readProcessMemoryMb(pid);
        const uptimeSeconds = Math.max(0, Math.floor((now - processStartedAt) / 1000));
        const droppedDelta = progress.droppedFrames === null
          ? null
          : Math.max(0, progress.droppedFrames - previousDroppedFrames);
        if (progress.droppedFrames !== null) previousDroppedFrames = progress.droppedFrames;
        const telemetryPayload = {
          streamId,
          status: rtmpConfirmed ? 'live' : 'starting',
          ...(progress.bitrateKbps !== null ? { bitrate_kbps: progress.bitrateKbps } : {}),
          ...(progress.fps !== null ? { fps: progress.fps } : {}),
          ...(progress.droppedFrames !== null ? { dropped_frames: progress.droppedFrames } : {}),
          ...(cpuSample.cpuPercent !== null ? { cpu_usage_pct: +cpuSample.cpuPercent.toFixed(2) } : {}),
          ...(ffmpegMemoryMb !== null ? { mem_usage_mb: ffmpegMemoryMb } : {}),
          speed: progress.speed === null ? null : `${progress.speed.toFixed(2)}x`,
          output_time_seconds: progress.outputTimeSeconds,
          playback_delay_seconds: progress.outputTimeSeconds === null
            ? null
            : +(uptimeSeconds - progress.outputTimeSeconds).toFixed(2),
          health_status: droppedDelta > 0 ? 'warning' : 'good',
          video_mode: attemptUsedDirectCopy ? 'copy' : 'transcode',
          transcode_reason: attemptUsedDirectCopy ? null : copyEligibility.reason,
          uptime_seconds: uptimeSeconds,
          destinations_count: activeDestinations.length,
          reconnect_attempts: reconnectAttempts,
          ...cacheTelemetry,
          ffmpegStartSequence: currentProcessSequence,
          sequence: ++telemetrySequence,
          timestamp: new Date(now).toISOString(),
        };

        if (!rtmpConfirmed && telemetryUpdateCount >= 3) {
          const stillOwned = await updateOwnedStream({
            status: 'live',
            ffmpeg_pid: pid,
            last_heartbeat: new Date(now).toISOString(),
            ...(progress.bitrateKbps !== null ? { current_bitrate_kbps: Math.round(progress.bitrateKbps) } : {}),
            ...(progress.fps !== null ? { fps: progress.fps } : {}),
            updated_at: new Date(now).toISOString(),
          });
          if (!stillOwned) {
            await handleLeaseLoss(new Error('Distributed stream ownership was lost while marking FFmpeg live.'));
            return;
          }
          rtmpConfirmed = true;
          telemetryPayload.status = 'live';
        }

        await publishTelemetry(telemetryPayload);
        if (now - lastProgressMetricsWriteAt >= 2000) {
          lastProgressMetricsWriteAt = now;
          const updates = {
            last_heartbeat: new Date(now).toISOString(),
            updated_at: new Date(now).toISOString(),
            ...(progress.bitrateKbps !== null ? { current_bitrate_kbps: Math.round(progress.bitrateKbps) } : {}),
            ...(progress.fps !== null ? { fps: progress.fps } : {}),
            ...(cpuSample.cpuPercent !== null ? { cpu_usage_pct: +cpuSample.cpuPercent.toFixed(2) } : {}),
          };
          const stillOwned = await updateOwnedStream(updates);
          if (!stillOwned) await handleLeaseLoss(new Error('Distributed stream ownership was lost during telemetry update.'));
        }
      };

      currentChild.stdout?.on('data', (chunk) => {
        progressBuffer += chunk.toString();
        if (progressBuffer.length > 64 * 1024) progressBuffer = progressBuffer.slice(-16 * 1024);
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = lines.pop() || '';
        for (const line of lines) {
          progressRecord.push(line);
          if (line.startsWith('progress=')) {
            const record = progressRecord.join('\n');
            progressRecord = [];
            void handleProgressRecord(record).catch(() => {});
          }
        }
      });

      // Independent heartbeat: keep last_heartbeat fresh in Supabase even when
      // FFmpeg stderr is silent, so a stale owner cannot steal the stream.
      const HEARTBEAT_INTERVAL_MS = 5000;
      const refreshHeartbeat = async () => {
        if ((isTerminated || streamController.isIntentionalStop)
          && (!currentChild || currentChild.exitCode != null || currentChild.signalCode != null)) return;
        try {
          const stillOwned = await updateOwnedStream({
            last_heartbeat: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          if (!stillOwned) {
            await handleLeaseLoss(new Error('Distributed stream ownership was lost during heartbeat.'));
          }
        } catch {
          // Transient DB error: do NOT kill the stream. The Redis lease is still
          // held; retry on the next tick. Repeated failures will surface via
          // Redis lease renewal rather than an immediate FFmpeg stop.
        }
      };
      refreshHeartbeat();
      heartbeatTimer = setInterval(refreshHeartbeat, HEARTBEAT_INTERVAL_MS);

      // stderr is retained for sanitized diagnostics; all live metrics come
      // from FFmpeg's structured -progress output on stdout.
      currentChild.stderr?.on('data', async (chunk) => {
        const raw = chunk.toString();
        for (const diagnostic of extractFfmpegErrorLines(raw, { secrets: sensitiveValues })) {
          if (recentFfmpegDiagnostics.at(-1) === diagnostic) continue;
          recentFfmpegDiagnostics.push(diagnostic);
          if (recentFfmpegDiagnostics.length > MAX_FFMPEG_DIAGNOSTICS) recentFfmpegDiagnostics.shift();
          console.warn("[FFmpeg Diagnostic] Stream " + streamId + ": " + diagnostic);
        }
      });

      currentChild.on('exit', async (code, signal) => {
        if (leaseLostError || childErrorHandled) return;
        if (startCopyFallback()) return;
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        if (progressWatchdogTimer) { clearInterval(progressWatchdogTimer); progressWatchdogTimer = null; }

        if (streamController.isIntentionalStop || isTerminated) {
          try {
            await updateOwnedStream({
              status: 'idle',
              ffmpeg_pid: null,
              last_error: null,
              updated_at: new Date().toISOString(),
            }, true);
          } catch {}
          await publishTelemetry({ streamId, status: 'idle', health_status: 'warning', timestamp: new Date().toISOString() });
          await releaseCachedR2Source();
          console.log(`[FFmpeg Exit] Stream ${streamId} idle (intentionally stopped/terminated)`);
          resolve();
        } else {
          // A non-intentional process exit is not a healthy live stream, even if
          // FFmpeg returns code 0 (e.g. the source ended before the loop resumed).
          await handleProcessCrash(new Error(`FFmpeg exited with code ${code}, signal ${signal}`), code, signal);
        }
      });
      currentChild.on('close', (code) => {
        if (!fallbackScheduled) console.log(`[FFmpeg Close] Stream ${streamId} process closed (code: ${code})`);
      });
    }

    // ------------------------------------------------------------------------
    // Autonomous Auto-Recovery & Restart Handler
    // - Up to 5 reconnect attempts (MAX_RESTART_RETRIES=5)
    // - 3-second exponential backoff delay (3s, 6s, 12s, 24s, 48s)
    // - Permanent failure after 5 attempts -> status: 'ERROR', detailed failure log
    // ------------------------------------------------------------------------
    async function handleProcessCrash(error, code, signal) {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (progressWatchdogTimer) { clearInterval(progressWatchdogTimer); progressWatchdogTimer = null; }
      if (isTerminated || streamController.isIntentionalStop) {
        activeStreams.delete(streamId);
        abortSignal?.removeEventListener('abort', handleAbort);
        await releaseCachedR2Source();
        resolve();
        return;
      }

      if (reconnectAttempts < MAX_RESTART_RETRIES) {
        reconnectAttempts++;

        // Exponential backoff: 3s * 2^(attempt - 1)
        const backoffDelay = Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1), 60000);
        const diagnostic = recentFfmpegDiagnostics.slice(-5).join(' | ');
        const retryMsg = sanitizeFfmpegDiagnostic(
          `FFmpeg stream process crashed (code: ${code !== null ? code : 'N/A'}, signal: ${signal || 'NONE'}). Autonomous auto-recovery attempt ${reconnectAttempts}/${MAX_RESTART_RETRIES} in ${(backoffDelay / 1000).toFixed(1)}s.${diagnostic ? ` Diagnostic: ${diagnostic}` : ''}`,
          { secrets: sensitiveValues, maxLength: 1800 },
        );
        console.warn(`[Auto-Recovery] Stream ${streamId}: ${retryMsg}`);

        try {
          const stillOwned = await updateOwnedStream({
            status: 'reconnecting',
            reconnect_attempts: reconnectAttempts,
            last_error: retryMsg,
            last_heartbeat: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          if (!stillOwned) {
            await handleLeaseLoss(new Error('Distributed stream ownership was lost during FFmpeg recovery.'));
            return;
          }

          try {
            await redisClient.publish(`stream:telemetry:${streamId}`, JSON.stringify({
              streamId,
              health_status: 'reconnecting',
              status: 'reconnecting',
              reconnectAttempts,
              maxRetries: MAX_RESTART_RETRIES,
              backoffDelaySeconds: backoffDelay / 1000,
              last_error: retryMsg,
              timestamp: new Date().toISOString(),
            }));
            await redisClient.publish('stream-telemetry-events', JSON.stringify({
              streamId,
              status: 'reconnecting',
              health_status: 'reconnecting',
              last_error: retryMsg,
              timestamp: new Date().toISOString(),
            }));
          } catch (e) {}
        } catch {
          await handleLeaseLoss(new Error('Distributed stream ownership could not be verified during FFmpeg recovery.'));
          return;
        }

        reconnectTimeout = scheduleRestartAfterExit({
          child: currentChild,
          delayMs: backoffDelay,
          shouldRestart: () => !isTerminated && !streamController.isIntentionalStop,
          restart: startFfmpegProcess,
        });
      } else {
        // Permanent failure: All 5 restart retries exhausted
        isTerminated = true;
        activeStreams.delete(streamId);
        abortSignal?.removeEventListener('abort', handleAbort);

        // Cleanly terminate any orphaned child process to free all system resources
        if (currentChild && !currentChild.killed) {
          try {
            currentChild.kill('SIGKILL');
          } catch (e) {}
        }

        const finalDiagnostic = recentFfmpegDiagnostics.slice(-5).join(' | ');
        const permanentFailureLog = sanitizeFfmpegDiagnostic(
          `CRITICAL FAILURE: FFmpeg stream failed after ${MAX_RESTART_RETRIES} reconnect attempts. Last exit code: ${code}, signal: ${signal}.${finalDiagnostic ? ` Diagnostic: ${finalDiagnostic}` : ' No actionable stderr diagnostic was captured.'}`,
          { secrets: sensitiveValues, maxLength: 1800 },
        );
        console.error(`[Permanent Failure] Stream ${streamId}: ${permanentFailureLog}`);

        try {
          const released = await updateOwnedStream({
            status: 'failed',
            ffmpeg_pid: null,
            reconnect_attempts: reconnectAttempts,
            last_error: permanentFailureLog,
            updated_at: new Date().toISOString(),
          }, true);
          if (!released) {
            await handleLeaseLoss(new Error('Distributed stream ownership was lost while recording FFmpeg failure.'));
            return;
          }

          await supabase
            .from('stream_telemetry_logs')
            .insert({
              stream_id: streamId,
              health_status: 'error',
              bitrate_kbps: 0,
              fps: 0,
              dropped_frames: 0,
              cpu_pct: 0,
              mem_mb: 0,
            });

          try {
            await redisClient.publish(`stream:telemetry:${streamId}`, JSON.stringify({
              streamId,
              status: 'failed',
              health_status: 'error',
              reconnectAttempts,
              maxRetries: MAX_RESTART_RETRIES,
              last_error: permanentFailureLog,
              timestamp: new Date().toISOString(),
            }));
            await redisClient.publish('stream-telemetry-events', JSON.stringify({
              streamId,
              status: 'failed',
              health_status: 'error',
              last_error: permanentFailureLog,
              timestamp: new Date().toISOString(),
            }));
          } catch (e) {}
        } catch {
          await handleLeaseLoss(new Error('Distributed stream ownership could not be verified while recording FFmpeg failure.'));
          return;
        }

        await releaseCachedR2Source();
        reject(new Error(permanentFailureLog));
      }
    }

    startFfmpegProcess();
  });
}

// ----------------------------------------------------------------------------
// 3. Dynamic Concurrency Loader (Enforced Maximum of 10)
// ----------------------------------------------------------------------------
async function loadDynamicConcurrency() {
  try {
    const cached = await redisClient.get('system_settings:primary_cluster');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.worker_concurrency) {
        return Math.min(parsed.worker_concurrency, MAX_CONCURRENT_STREAMS);
      }
    }

    const { data, error } = await supabase
      .from('system_settings')
      .select('worker_concurrency')
      .eq('id', 'primary_cluster')
      .single();

    if (!error && data?.worker_concurrency) {
      return Math.min(data.worker_concurrency, MAX_CONCURRENT_STREAMS);
    }
  } catch (err) {
    console.warn(`[Dynamic Scaler] Using default concurrency (${DEFAULT_CONCURRENCY}):`, err.message);
  }
  return DEFAULT_CONCURRENCY;
}

// ----------------------------------------------------------------------------
// 4. BullMQ Worker Instance
// ----------------------------------------------------------------------------
currentConcurrency = await loadDynamicConcurrency();

export const streamWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === 'start-stream') {
      const streamId = job.data?.streamId;
      if (typeof streamId !== 'string' || !streamId) throw new Error('Stream start job is missing its stream ID.');
      const result = await runWithStreamLease({
        redis: redisClient,
        streamId,
        run: async (lease) => {
          const abortController = new AbortController();
          const pendingStart = { abortController, jobId: job.id };
          pendingStreamStarts.set(streamId, pendingStart);
          try {
            return await launchFfmpegStream(job, lease, abortController.signal);
          } finally {
            if (pendingStreamStarts.get(streamId) === pendingStart) pendingStreamStarts.delete(streamId);
          }
        },
      });
      if (!result.acquired) {
        console.log(`[Distributed Stream Lock] Stream ${streamId} is owned by another worker; duplicate job will not spawn FFmpeg.`);
      }
    }
  },
  {
    connection: redisConfig,
    concurrency: currentConcurrency,
    limiter: {
      max: MAX_CONCURRENT_STREAMS * 2,
      duration: 1000,
    },
  }
);

console.log('[BullMQ Worker] Listening on "' + QUEUE_NAME + '" with active concurrency: ' + currentConcurrency + ' (Max Cap: ' + MAX_CONCURRENT_STREAMS + ')');

streamWorker.on('completed', (job) => {
  console.log('[BullMQ Job] Job ' + job.id + ' completed. Active: ' + activeStreams.size + '/' + MAX_CONCURRENT_STREAMS);
});

streamWorker.on('failed', (job, err) => {
  console.error('[BullMQ Job] Job ' + job?.id + ' failed:', err?.message);
});

// ----------------------------------------------------------------------------
// 5. Container Heartbeat & Memory Watchdog Loop
// Runs every 5s to report health for Docker HEALTHCHECK and guard memory limits
// ----------------------------------------------------------------------------
const watchdogTimer = setInterval(async () => {
  const mem = process.memoryUsage();
  const rssMb = +(mem.rss / (1024 * 1024)).toFixed(1);
  const heapUsedMb = +(mem.heapUsed / (1024 * 1024)).toFixed(1);

  const heartbeatData = {
    workerNodeId: WORKER_NODE_ID,
    timestamp: Date.now(),
    activeStreams: activeStreams.size,
    maxConcurrentStreams: MAX_CONCURRENT_STREAMS,
    concurrency: currentConcurrency,
    storageProvider: STORAGE_PROVIDER,
    memory: { rssMb, heapUsedMb },
  };

  // 1. Write to local file for Docker HEALTHCHECK
  try {
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(heartbeatData), 'utf-8');
  } catch (err) {}

  // 2. Publish to Redis for cluster monitoring
  try {
    await redisClient.set(
      `worker:heartbeat:${WORKER_NODE_ID}`,
      JSON.stringify(heartbeatData),
      'EX',
      15
    );
  } catch (err) {}

  // 3. Memory Watchdog (Guard against container OOM kill)
  if (rssMb > MEMORY_CEILING_MB) {
    console.warn('[Memory Watchdog CRITICAL] Worker RSS memory (' + rssMb + 'MB) approached ceiling (' + MEMORY_CEILING_MB + 'MB). Initiating graceful worker cycling...');
    clearInterval(watchdogTimer);
    await shutdownWorker('MEMORY_CEILING_GUARD');
  }
}, 5000);

// ----------------------------------------------------------------------------
// 6. Distributed Dynamic Concurrency & Stream Stop Subscriptions
// ----------------------------------------------------------------------------
const subClient = redisClient.duplicate();

await subClient.subscribe('cluster-scaling-events', 'stream-control-bus', (err) => {
  if (err) {
    console.error('[Redis PubSub] Subscription error:', err);
  } else {
    console.log('[Redis PubSub] Subscribed to cluster control channels');
  }
});

subClient.on('message', async (channel, message) => {
  try {
    const payload = JSON.parse(message);

    // Dynamic Concurrency Scaling Event (Clamped to MAX_CONCURRENT_STREAMS)
    if (channel === 'cluster-scaling-events' && payload.workerConcurrency) {
      const requested = parseInt(payload.workerConcurrency, 10);
      const clamped = Math.min(requested, MAX_CONCURRENT_STREAMS);
      if (clamped && clamped !== currentConcurrency) {
        console.log(`[1-Click Scaler] Dynamically scaling worker concurrency in RAM: ${currentConcurrency} -> ${clamped} (Hard cap: ${MAX_CONCURRENT_STREAMS})`);
        currentConcurrency = clamped;
        streamWorker.concurrency = currentConcurrency;
      }
    }

    // Selective Stream Stop Command (Distributed Kill Switch)
    if (channel === 'stream-control-bus' && payload.action === 'STOP' && payload.streamId) {
      console.log(`[Stream Control Bus] Received STOP directive for stream: ${payload.streamId}`);
      await stopStreamProcess(payload.streamId, 'Remote API Gateway STOP command');
    }
  } catch (err) {
    console.error('[Redis PubSub Error]', err);
  }
});

// ----------------------------------------------------------------------------
// 7. Graceful Host Shutdown Handler
// ----------------------------------------------------------------------------
async function shutdownWorker(signal) {
  console.log(`\\n[Shutdown] Received ${signal}. Gracefully stopping all ${activeStreams.size} active streams...`);

  clearInterval(watchdogTimer);
  try {
    await streamWorker.pause(true);
  } catch {}
  for (const pendingStart of pendingStreamStarts.values()) {
    pendingStart.abortController.abort();
  }

  // Each stream stop releases its fenced ownership claim only after FFmpeg exit
  // is confirmed. Never clear claims ahead of child termination during recycle.
  const stopped = await stopStreamsThenClose({
    streamIds: Array.from(activeStreams.keys()),
    stopStream: (streamId) => stopStreamProcess(streamId, `Worker container recycle (${signal})`),
    closeResources: async () => {
      try { await streamWorker.close(); } catch {}
      try { await subClient.quit(); await redisClient.quit(); } catch {}
    },
  });
  if (!stopped) {
    console.error('[Shutdown] At least one FFmpeg exit is unconfirmed; retaining worker ownership and Redis connections.');
    return;
  }

  console.log('[Shutdown] All worker resources cleaned up. Exiting process.');
  process.exit(signal === 'MEMORY_CEILING_GUARD' ? 1 : 0);
}

// Helper: release Redis lease and reset Supabase stream status
//
// The Redis lease delete is fenced: we only remove the key if this process
// still holds the ownership token. An unfenced DEL would allow a stopping
// worker to steal/delete another worker's active stream lock, causing the
// "stream is owned by another runtime" / distributed lock loss errors.
async function releaseStreamLockAndReset(streamId, status = 'idle', errorMsg = null) {
  try {
    // Release Redis lease if it exists (fenced by ownership token)
    const leaseKey = `streempulse:active-stream:${streamId}`;
    const streamInstance = activeStreams.get(streamId);
    const token = streamInstance?.leaseToken || null;
    try {
      if (token) {
        const current = await redisClient.get(leaseKey);
        if (current === token) {
          await redisClient.del(leaseKey);
        }
      } else {
        // No token tracked (e.g. called before lease acquisition): fall back
        // to unfenced delete only when this process is exiting.
        await redisClient.del(leaseKey);
      }
    } catch {}
    // Clear Supabase heartbeat and ownership for the stream (fenced: only this
    // process's own token can clear the claim, preventing lock theft).
    try {
      const fenceToken = streamInstance?.leaseToken || null;
      let ownershipQuery = supabase
        .from('streams')
        .update({ status, ffmpeg_pid: null, worker_node_id: null, last_heartbeat: null, updated_at: new Date().toISOString() })
        .eq('id', streamId);
      if (fenceToken) {
        ownershipQuery = ownershipQuery.eq('worker_node_id', fenceToken);
      } else {
        ownershipQuery = ownershipQuery.is('worker_node_id', null);
      }
      await ownershipQuery;
    } catch {}
    // Publish telemetry event for dashboard
    try {
      await redisClient.publish('stream-telemetry-events', JSON.stringify({
        streamId,
        status,
        health_status: errorMsg ? 'error' : 'warning',
        last_error: errorMsg || null,
        timestamp: new Date().toISOString(),
      }));
    } catch {}
  } catch {}
}

// Helper: reset all streams stuck in 'starting' or 'queued' at boot
async function resetStuckStreams() {
  try {
    const streams = readStreams?.() || [];
    for (const s of streams) {
      if (s.status === 'starting' || s.status === 'queued') {
        s.status = 'idle';
        s.ffmpeg_pid = null;
        s.last_error = null;
        s.updated_at = new Date().toISOString();
        await writeStreams(streams);
        console.log(`[Boot] Reset stream ${s.id} to 'idle'`);
      }
    }
  } catch (err) {
    console.warn('[Boot] Failed to reset stuck streams:', err?.message || err);
  }
}

process.on('SIGTERM', () => shutdownWorker('SIGTERM'));
process.on('SIGINT', () => shutdownWorker('SIGINT'));

