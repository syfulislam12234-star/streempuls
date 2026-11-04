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
import { resolveLocalUpload } from './localVideoSource.js';

dotenv.config();

// ----------------------------------------------------------------------------
// Worker Node Identity & Capacity Configuration
// ----------------------------------------------------------------------------
export const WORKER_NODE_ID = process.env.WORKER_NODE_ID || `worker-node-${process.pid}`;
export const MAX_CONCURRENT_STREAMS = parseInt(process.env.MAX_CONCURRENT_STREAMS || '10', 10);
export const MAX_RESTART_RETRIES = parseInt(process.env.MAX_RESTART_RETRIES || '5', 10);
const BASE_RECONNECT_DELAY_MS = 3000; // 3-second base exponential backoff
const DEFAULT_CONCURRENCY = Math.min(parseInt(process.env.WORKER_CONCURRENCY || '10', 10), MAX_CONCURRENT_STREAMS);
let currentConcurrency = DEFAULT_CONCURRENCY;

const HEARTBEAT_FILE = path.resolve('/tmp/worker-heartbeat.json');
const DEFAULT_UPLOADS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../uploads');
const MEMORY_CEILING_MB = parseInt(process.env.MEMORY_CEILING_MB || '1850', 10); // Hard limit 2048MB, soft cycle at 1850MB
const CONTAINER_HARD_MEMORY_LIMIT_MB = 2048;

console.log(`====================================================================`);
console.log(`[StreamPulse Worker] Node ID: ${WORKER_NODE_ID}`);
console.log(`[StreamPulse Worker] Queue: "${QUEUE_NAME}"`);
console.log(`[StreamPulse Worker] Hard Limit: MAX ${MAX_CONCURRENT_STREAMS} concurrent streams per container`);
console.log(`[StreamPulse Worker] Auto-Recovery: MAX ${MAX_RESTART_RETRIES} retries with ${BASE_RECONNECT_DELAY_MS / 1000}s exponential backoff`);
console.log(`[StreamPulse Worker] Zero-Lag Stream Pacing: -fflags nobuffer, -flags low_delay, -rtbufsize 1024M, -muxdelay 0.1`);
console.log(`[StreamPulse Worker] Storage Provider: ${STORAGE_PROVIDER.toUpperCase()} (Bucket: ${SUPABASE_STORAGE_BUCKET})`);
console.log(`====================================================================`);

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
  if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    let forceKillTimer;
    let finalTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimer);
      clearTimeout(finalTimer);
      child.removeListener?.('exit', finish);
      resolve();
    };

    child.once?.('exit', finish);
    forceKillTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { finish(); return; }
      finalTimer = setTimeout(finish, 1000);
    }, gracePeriodMs);
    forceKillTimer.unref?.();

    try { child.kill('SIGTERM'); } catch { finish(); }
  });
}

function redactUrlQuery(value) {
  try {
    const url = new URL(value);
    return url.search ? `${url.origin}${url.pathname}?[REDACTED]` : value;
  } catch {
    return value;
  }
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
      console.log(`[Process Tracker] Cancelled pending start for stream ${streamId} on worker node ${WORKER_NODE_ID}.`);
      return true;
    }
    console.log(`[Process Tracker] Stream ${streamId} not running on worker node ${WORKER_NODE_ID}.`);
    return false;
  }

  console.log(`[Process Tracker] Terminating stream ${streamId} (Reason: ${reason})`);
  streamInstance.isIntentionalStop = true;

  if (typeof streamInstance.stop === 'function') {
    return await streamInstance.stop(reason);
  }

  const { child, pid } = streamInstance;
  return new Promise((resolve) => {
    const forceKillTimer = setTimeout(() => {
      try {
        console.warn(`[Process Tracker] Stream ${streamId} PID ${pid} did not exit in 5s. Sending SIGKILL.`);
        child?.kill('SIGKILL');
      } catch (err) {}
    }, 5000);

    child?.once('exit', () => {
      clearTimeout(forceKillTimer);
      activeStreams.delete(streamId);
      console.log(`[Process Tracker] Stream ${streamId} stopped. Remaining active: ${activeStreams.size}/${MAX_CONCURRENT_STREAMS}`);
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
    const overloadNotice = `[Container Overload Auto-Shift] Worker container ${WORKER_NODE_ID} saturated (${activeStreams.size}/${MAX_CONCURRENT_STREAMS}). Auto-shifting stream ${streamId} to next idle worker node...`;
    console.warn(overloadNotice);
    throw new Error(`CONTAINER_OVERLOAD: ${overloadNotice}`);
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
    if (r2Provider) await r2Provider.headObject(cleanPath);
    let signedUrl = null;
    try {
      signedUrl = r2Provider
        ? await r2Provider.getSignedUrl(cleanPath, SIGNED_SOURCE_URL_TTL_MS / 1000)
        : await getSignedStorageUrl(cleanPath);
    } catch (signErr) {
      console.warn(`[FFmpeg Engine] Storage URL signing failed for stream ${streamId}: ${signErr.message`});
    }
    inputSource = signedUrl || getPublicStorageUrl(cleanPath);
    if (signedUrl) {
      const provider = r2Provider || getStorageProvider(STORAGE_PROVIDER);
      refreshSignedInputSource = () => provider.getSignedUrl(cleanPath, SIGNED_SOURCE_URL_TTL_MS / 1000);
      signedUrlGeneratedAt = Date.now();
      signedUrlTtlMs = SIGNED_SOURCE_URL_TTL_MS;
    }
    }
  } else if (typeof videoUrl === 'string' && /^https?:\/\//i.test(videoUrl)) {
    try {
      const parsedUrl = new URL(videoUrl);
      const r2Provider = getStorageProvider('r2');
      const r2Object = parseR2ObjectUrl(videoUrl, {
        bucket: r2Provider.bucket,
        endpoint: r2Provider.endpoint,
        publicDomain: r2Provider.publicDomain,
      });
      const pathname = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''));
      const supabaseStorageMatch = pathname.match(/^storage\/v1\/object\/(?:public|sign|authenticated)\/[^/]+\/(.+)$/);
      const isSupabaseStorageUrl = parsedUrl.hostname.includes('supabase.co') && Boolean(supabaseStorageMatch);
      if (r2Object || isSupabaseStorageUrl) {
        const isR2Url = Boolean(r2Object);
        const objectKey = isR2Url ? r2Object.key : supabaseStorageMatch[1];
        const provider = isR2Url ? r2Provider : getStorageProvider('supabase');
        if (isR2Url) await provider.headObject(objectKey);
        const signedUrl = await provider.getSignedUrl(objectKey, SIGNED_SOURCE_URL_TTL_MS / 1000);
        if (signedUrl && signedUrl !== videoUrl) {
          inputSource = signedUrl;
          refreshSignedInputSource = () => provider.getSignedUrl(objectKey, SIGNED_SOURCE_URL_TTL_MS / 1000);
          signedUrlGeneratedAt = Date.now();
          signedUrlTtlMs = SIGNED_SOURCE_URL_TTL_MS;
        }
      }
    } catch (signErr) {
      console.warn("[FFmpeg Engine] Storage URL signing failed for stream " + streamId + ": " + signErr.message);
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
    const isVertical = orientation === 'vertical';
    const recentFfmpegDiagnostics = [];
    let leaseLostError = null;
    let leaseLossHandled = false;
    let heartbeatTimer = null;
    const handleAbort = () => { void streamController.stop('Start cancelled before broadcast'); };
    const updateOwnedStream = (updates, release = false) => updateStreamWhenOwned(supabase, {
      streamId,
      token: ownershipToken,
      updates,
      release,
    });

  console.log(`[FFmpeg Engine] Preparing stream ${streamId} | Destinations: ${activeDestinations.length}`);
  console.log(`[FFmpeg Engine] Source: ${redactUrlQuery(inputSource)} | Vertical: ${isVertical} | DirectCopy: ${directCopyMode !== false}`);

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
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }

        await terminateFfmpegChild(currentChild);
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

        console.log(`[Process Tracker] Stream ${streamId} cleanly stopped (${reason}). Active: ${activeStreams.size}/${MAX_CONCURRENT_STREAMS}`);
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
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      streamController.isIntentionalStop = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      await terminateFfmpegChild(currentChild);
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

      if (lease?.lost) {
        await handleLeaseLoss(new Error('Distributed stream lock was lost before FFmpeg startup.'));
        return;
      }

      console.log(`[FFmpeg Spawn] Starting 24/7 stream: ${streamId} (Attempt ${reconnectAttempts + 1}/${MAX_RESTART_RETRIES + 1})`);

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
        '-muxdelay', '0.1'
      );

      if (isVertical) {
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
        if (directCopyMode !== false) {
          ffmpegArgs.push(
            '-c:v', 'copy',
            '-c:a', 'aac'
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
          .map((url) => `[f=flv:onfail=ignore]${url}`)
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
      currentChild = spawn('ffmpeg', ffmpegArgs);
      const pid = currentChild.pid;

      if (!pid) {
        handleProcessCrash(new Error('Failed to spawn FFmpeg child process'), null, null);
        return;
      }

      console.log(`[FFmpeg Spawn] Stream ${streamId} active with PID ${pid} (Attempts used: ${reconnectAttempts}/${MAX_RESTART_RETRIES})`);

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

      // Independent heartbeat: keep last_heartbeat fresh in Supabase even when
      // FFmpeg stderr is silent, so a stale owner cannot steal the stream.
      const HEARTBEAT_INTERVAL_MS = 5000;
      const refreshHeartbeat = async () => {
        if (isTerminated || streamController.isIntentionalStop) return;
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

      // Track whether RTMP connection has been confirmed via first telemetry.
      let rtmpConfirmed = false;

      // Stream-specific stderr telemetry feed via Redis Pub/Sub
      let lastTelemetryUpdate = 0;
    let lastCpuUsage = { user: 0, system: 0 };
      currentChild.stderr?.on('data', async (chunk) => {
        const raw = chunk.toString();
        for (const diagnostic of extractFfmpegErrorLines(raw, { secrets: sensitiveValues })) {
          if (recentFfmpegDiagnostics.at(-1) === diagnostic) continue;
          recentFfmpegDiagnostics.push(diagnostic);
          if (recentFfmpegDiagnostics.length > MAX_FFMPEG_DIAGNOSTICS) recentFfmpegDiagnostics.shift();
          console.warn(`[FFmpeg Diagnostic] Stream ${streamId}: ${diagnostic}`);
        }
        const now = Date.now();
        const bitrateMatch = raw.match(/bitrate=\s*([0-9.]+kbits\/s)/);
        const fpsMatch = raw.match(/fps=\s*([0-9.]+)/);
        const dropMatch = raw.match(/drop=\s*([0-9]+)/);

        if (now - lastTelemetryUpdate > 2000) {
          lastTelemetryUpdate = now;
          const memUsage = process.memoryUsage();
          const currentBitrate = bitrateMatch ? parseInt(bitrateMatch[1], 10) : 6000;
          const currentFps = fpsMatch ? parseFloat(fpsMatch[1]) : 60.0;
          const droppedFrames = dropMatch ? parseInt(dropMatch[1], 10) : 0;
          // Genuine CPU measurement using process.cpuUsage() with elapsed wall-clock time.
          // Tracks previous reading to calculate percentage over time.
          const cpuUsageNow = process.cpuUsage ? process.cpuUsage() : { user: 0, system: 0 };
          const cpuDelta = (typeof lastCpuUsage === 'object' && lastCpuUsage.user !== undefined)
            ? cpuUsageNow.user + cpuUsageNow.system - lastCpuUsage.user - lastCpuUsage.system
            : cpuUsageNow.user + cpuUsageNow.system;
          const wallDelta = now - (lastTelemetryUpdate > 0 ? lastTelemetryUpdate : now);
          const cpuUsagePct = wallDelta > 0 ? Math.min(100, (cpuDelta / wallDelta) * 100) : 0;
          // Store for next measurement
          lastCpuUsage = cpuUsageNow;
          const memMb = +(memUsage.rss / (1024 * 1024)).toFixed(1);

          const telemetryPayload = {
            streamId,
            bitrate_kbps: currentBitrate,
            fps: currentFps,
            dropped_frames: droppedFrames,
            cpu_usage_pct: cpuUsagePct,
            mem_usage_mb: memMb,
            health_status: droppedFrames > 5 ? 'warning' : 'excellent',
            speed: '1.00x',
            destinations_count: activeDestinations.length,
            reconnect_attempts: reconnectAttempts,
            ffmpegStartSequence: currentProcessSequence,
            sequence: ++telemetrySequence,
            timestamp: new Date().toISOString(),
          };

          // Ignore events from an older FFmpeg process (stale telemetry).
          if (currentProcessSequence !== ffmpegStartSequence) {
            return;
          }

          // Sustained telemetry check: require 3 consecutive updates before marking 'live'.
          // A single bitrate/fps line only means encoding started, not that RTMP output succeeded.
          if (!rtmpConfirmed && (bitrateMatch || fpsMatch)) {
            telemetryUpdateCount++;
            if (telemetryUpdateCount >= 3) {
              rtmpConfirmed = true;
              try {
                const stillOwned = await updateOwnedStream({
                  status: 'live',
                  ffmpeg_pid: pid,
                  last_heartbeat: new Date().toISOString(),
                  current_bitrate_kbps: currentBitrate,
                  fps: currentFps,
                  updated_at: new Date().toISOString(),
                });
                if (!stillOwned) {
                  await handleLeaseLoss(new Error('Distributed stream ownership was lost while marking FFmpeg live.'));
                  return;
                }
              } catch {
                await handleLeaseLoss(new Error('Distributed stream ownership could not be verified while marking FFmpeg live.'));
                return;
              }
              try {
                await redisClient.publish('stream-telemetry-events', JSON.stringify({
                  streamId,
                  status: 'live',
                  health_status: telemetryPayload.health_status,
                  bitrate_kbps: currentBitrate,
                  fps: currentFps,
                  timestamp: new Date().toISOString(),
                }));
              } catch (pubErr) {
                console.warn(`[Redis Notice] Failed publishing live for ${streamId}:`, pubErr.message);
              }
            }
          } else if (!rtmpConfirmed) {
            telemetryUpdateCount = 0;
          }

          try {
            await redisClient.publish(`stream:telemetry:${streamId}`, JSON.stringify(telemetryPayload));
            await redisClient.publish('stream-telemetry-events', JSON.stringify(telemetryPayload));
          } catch (pubErr) {}

          try {
            const stillOwned = await updateOwnedStream({
              last_heartbeat: new Date().toISOString(),
              current_bitrate_kbps: currentBitrate,
              fps: currentFps,
              cpu_usage_pct: cpuUsagePct,
              mem_usage_mb: memMb,
              updated_at: new Date().toISOString(),
            });
            if (!stillOwned) await handleLeaseLoss(new Error('Distributed stream ownership was lost during heartbeat.'));
          } catch {
            // Transient DB error: keep streaming; Redis lease is still valid.
          }
        }
      });

      currentChild.on('error', (err) => {
        const safeError = sanitizeChildProcessError(err, { secrets: sensitiveValues });
        const errorMsg = `FFmpeg child process error: ${safeError}`;
        console.error(`[FFmpeg Child Error] Stream ${streamId}: ${errorMsg}`);
        // Clear 'starting' state and mark as failed
        try {
          void updateOwnedStream({
            status: 'failed',
            last_error: errorMsg,
            ffmpeg_pid: null,
            updated_at: new Date().toISOString(),
          }, true);
        } catch {}
        try {
          void redisClient.publish(`stream:telemetry:${streamId}`, JSON.stringify({
            streamId,
            status: 'failed',
            health_status: 'error',
            last_error: errorMsg,
            timestamp: new Date().toISOString(),
          }));
          void redisClient.publish('stream-telemetry-events', JSON.stringify({
            streamId,
            status: 'failed',
            health_status: 'error',
            last_error: errorMsg,
            timestamp: new Date().toISOString(),
          }));
        } catch {}
      });

      currentChild.on('exit', async (code, signal) => {
        if (leaseLostError) return;
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        // Always clear the 'starting' state regardless of outcome
        try {
          await updateOwnedStream({
            status: 'idle',
            ffmpeg_pid: null,
            last_error: null,
            updated_at: new Date().toISOString(),
          }, true);
        } catch {}
        // Also publish clearing the starting state via Redis
        try {
          void redisClient.publish(`stream:telemetry:${streamId}`, JSON.stringify({
            streamId,
            status: 'idle',
            health_status: 'warning',
            bitrate_kbps: 0,
            fps: 0,
            timestamp: new Date().toISOString(),
          }));
          void redisClient.publish('stream-telemetry-events', JSON.stringify({
            streamId,
            status: 'idle',
            health_status: 'warning',
            bitrate_kbps: 0,
            fps: 0,
            timestamp: new Date().toISOString(),
          }));
        } catch {}

        if (streamController.isIntentionalStop || isTerminated) {
          // Stream was intentionally stopped or terminated - mark as idle, not live
          try {
            void updateOwnedStream({
              status: 'idle',
              ffmpeg_pid: null,
              last_error: null,
              updated_at: new Date().toISOString(),
            }, true);
          } catch {}
          try {
            void redisClient.publish(`stream:telemetry:${streamId}`, JSON.stringify({
              streamId,
              status: 'idle',
              health_status: 'warning',
              bitrate_kbps: 0,
              fps: 0,
              timestamp: new Date().toISOString(),
            }));
            void redisClient.publish('stream-telemetry-events', JSON.stringify({
              streamId,
              status: 'idle',
              health_status: 'warning',
              bitrate_kbps: 0,
              fps: 0,
              timestamp: new Date().toISOString(),
            }));
          } catch {}
          console.log(`[FFmpeg Exit] Stream ${streamId} idle (intentionally stopped/terminated)`);
          resolve();
        } else if (code === 0 && !signal) {
          // Success: FFmpeg exited cleanly with exit code 0 and no signal
          try {
            void updateOwnedStream({
              status: 'live',
              ffmpeg_pid: null,
              last_heartbeat: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, true);
          } catch {}
          try {
            void redisClient.publish('stream-telemetry-events', JSON.stringify({
              streamId,
              status: 'live',
              health_status: 'excellent',
              bitrate_kbps: 0,
              fps: 0,
              timestamp: new Date().toISOString(),
            }));
          } catch {}
          console.log(`[FFmpeg Exit] Stream ${streamId} live (exit code: ${code}, signal: ${signal})`);
          resolve();
        } else {
          // Failure: unexpected crash, non-zero exit code, or network drop
          const exitMsg = `FFmpeg exited with code ${code}, signal ${signal}`;
          console.error(`[FFmpeg Exit Error] Stream ${streamId}: ${exitMsg}`);
          try {
            void updateOwnedStream({
              status: 'failed',
              last_error: exitMsg,
              ffmpeg_pid: null,
              updated_at: new Date().toISOString(),
            }, true);
          } catch {}
          try {
            void redisClient.publish(`stream:telemetry:${streamId}`, JSON.stringify({
              streamId,
              status: 'failed',
              health_status: 'error',
              last_error: exitMsg,
              timestamp: new Date().toISOString(),
            }));
            void redisClient.publish('stream-telemetry-events', JSON.stringify({
              streamId,
              status: 'failed',
              health_status: 'error',
              last_error: exitMsg,
              timestamp: new Date().toISOString(),
            }));
          } catch {}
        }
      });
      currentChild.on('close', (code) => {
        // Always clear the 'starting' state on close
        try {
          void updateOwnedStream({
            status: 'idle',
            ffmpeg_pid: null,
            last_error: null,
            updated_at: new Date().toISOString(),
          }, true);
        } catch {}
        try {
          void redisClient.publish(`stream:telemetry:${streamId}`, JSON.stringify({
            streamId,
            status: 'idle',
            health_status: 'warning',
            bitrate_kbps: 0,
            fps: 0,
            timestamp: new Date().toISOString(),
          }));
          void redisClient.publish('stream-telemetry-events', JSON.stringify({
            streamId,
            status: 'idle',
            health_status: 'warning',
            bitrate_kbps: 0,
            fps: 0,
            timestamp: new Date().toISOString(),
          }));
        } catch {}
        console.log(`[FFmpeg Close] Stream ${streamId} starting state cleared (close code: ${code})`);
      });
    }

    // ------------------------------------------------------------------------
    // Autonomous Auto-Recovery & Restart Handler
    // - Up to 5 reconnect attempts (MAX_RESTART_RETRIES=5)
    // - 3-second exponential backoff delay (3s, 6s, 12s, 24s, 48s)
    // - Permanent failure after 5 attempts -> status: 'ERROR', detailed failure log
    // ------------------------------------------------------------------------
    async function handleProcessCrash(error, code, signal) {
      if (isTerminated || streamController.isIntentionalStop) {
        activeStreams.delete(streamId);
        abortSignal?.removeEventListener('abort', handleAbort);
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

        reconnectTimeout = setTimeout(() => {
          if (!isTerminated && !streamController.isIntentionalStop) {
            startFfmpegProcess();
          } else {
            activeStreams.delete(streamId);
            resolve();
          }
        }, backoffDelay);
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

console.log(`[BullMQ Worker] Listening on "${QUEUE_NAME}" with active concurrency: ${currentConcurrency} (Max Cap: ${MAX_CONCURRENT_STREAMS})`);

streamWorker.on('completed', (job) => {
  console.log(`[BullMQ Job] Job ${job.id} completed. Active: ${activeStreams.size}/${MAX_CONCURRENT_STREAMS}`);
});

streamWorker.on('failed', (job, err) => {
  console.error(`[BullMQ Job] Job ${job?.id} failed:`, err?.message);
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
    console.warn(`[Memory Watchdog CRITICAL] Worker RSS memory (${rssMb}MB) approached ceiling (${MEMORY_CEILING_MB}MB). Initiating graceful worker cycling...`);
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
  console.log(`\n[Shutdown] Received ${signal}. Gracefully stopping all ${activeStreams.size} active streams...`);

  clearInterval(watchdogTimer);
  try {
    await streamWorker.pause(true);
  } catch {}
  for (const pendingStart of pendingStreamStarts.values()) {
    pendingStart.abortController.abort();
  }

  // Terminate active child processes gracefully with SIGTERM
  const stopPromises = Array.from(activeStreams.keys()).map((streamId) =>
    stopStreamProcess(streamId, `Worker container recycle (${signal})`)
  );

  // Also release Redis locks and reset Supabase status for all streams
  await Promise.all(
    Array.from(activeStreams.keys()).map((streamId) =>
      releaseStreamLockAndReset(streamId, 'idle')
    )
  );

  await Promise.all(stopPromises);

  // All stream processors have now settled, so close can drain safely.
  try {
    await streamWorker.close();
  } catch (e) {}

  try {
    await subClient.quit();
    await redisClient.quit();
  } catch (e) {}

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
        console.log(`[Boot] Reset stream ${s.id} from '${s.status}' to 'idle'`);
      }
    }
  } catch (err) {
    console.warn('[Boot] Failed to reset stuck streams:', err?.message || err);
  }
}

process.on('SIGTERM', () => shutdownWorker('SIGTERM'));
process.on('SIGINT', () => shutdownWorker('SIGINT'));

