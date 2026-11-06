/**
 * Upload-time video normalization (heavy transcoding, once per video).
 *
 * Normalizes an uploaded video to the strict live-stream direct-copy profile:
 *   ffmpeg -i input -vf "scale=1080:1920:force_original_aspect_ratio=decrease,
 *   pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=30" -c:v libx264
 *   -preset medium -profile:v high -pix_fmt yuv420p -b:v 4500k -maxrate 5000k
 *   -bufsize 9000k -g 60 -keyint_min 60 -sc_threshold 0 -c:a aac -b:a 128k
 *   -ar 44100 -ac 2 -movflags +faststart output.mp4
 *
 * Concurrency is limited by a Redis slot lock (max 1-2 jobs at a time). The
 * FFmpeg process is spawned under `nice` (lowest niceness on Linux) so
 * normalization can never starve live streams, the API, Redis or Coolify.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { redisClient } from './queue.js';
import { getStorageProvider } from './storage.js';
import { getR2Configuration } from './r2Config.js';
import { downloadVideoToLocalFile } from './localVideoSource.js';
import { supabase, SUPABASE_ADMIN_CONFIGURED } from './supabase.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '..', 'data');
const UPLOADED_ASSETS_FILE = path.join(DATA_DIR, 'uploaded_assets.json');
const TEMP_DIR = process.env.NORMALIZE_TEMP_DIR || os.tmpdir();

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

function readUploadedAssets() {
  const assets = readJsonFile(UPLOADED_ASSETS_FILE, []);
  return Array.isArray(assets) ? assets : [];
}
function writeUploadedAssets(assets) {
  writeJsonFile(UPLOADED_ASSETS_FILE, assets);
}

// ---------------------------------------------------------------------------
// Normalization slot lock: max NORMALIZE_CONCURRENCY (default 2) jobs at a time
// ---------------------------------------------------------------------------
const NORMALIZE_SLOT_COUNT = Math.max(1, Math.min(2, Number(process.env.NORMALIZE_CONCURRENCY || '2')));
const NORMALIZE_SLOT_TTL_SECONDS = Math.max(60, Number(process.env.NORMALIZE_SLOT_TTL_SECONDS || '3600'));
const NORMALIZE_SLOT_RENEW_MS = Math.max(5000, Number(process.env.NORMALIZE_SLOT_RENEW_MS || '25000'));
const NORMALIZE_NICE_LEVEL = Number(process.env.NORMALIZE_NICE_LEVEL || '15');
const NORMALIZE_QUEUE_NAME = process.env.NORMALIZE_QUEUE_NAME || 'normalization-queue';
const NORMALIZED_OBJECT_PREFIX = 'normalized/';

const slotOwnerToken = `${process.env.WORKER_NODE_ID || 'normalize-worker'}:${process.pid}:${randomUUID()}`;

/**
 * Acquire one free normalization slot. Slots are Redis keys with a TTL so a
 * crashed worker frees the slot automatically.
 * @returns {Promise<{key: string, release: () => Promise<void>} | null>}
 */
async function acquireNormalizeSlot() {
  for (let index = 0; index < NORMALIZE_SLOT_COUNT; index++) {
    const key = `streempulse:normalize:slot:${index}`;
    const result = await redisClient.set(key, slotOwnerToken, 'EX', NORMALIZE_SLOT_TTL_SECONDS, 'NX');
    if (result === 'OK') {
      return {
        key,
        release: async () => {
          try {
            const current = await redisClient.get(key);
            if (current === slotOwnerToken) await redisClient.del(key);
          } catch {}
        },
      };
    }
  }
  return null;
}

async function renewNormalizeSlot(lease) {
  if (!lease) return;
  try {
    await redisClient.expire(lease.key, NORMALIZE_SLOT_TTL_SECONDS);
  } catch {}
}

/**
 * Spawn a command and wait for exit. FFmpeg progress is written to stderr;
 * we capture it only for diagnostics on failure.
 */
async function spawnAndWait(command, args, { label = 'process' } = {}) {
  return new Promise((resolve, reject) => {
    let stderrOutput = '';
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderrOutput += chunk.toString();
      });
    }
    child.on('error', (err) => {
      reject(new Error(`${label} spawn failed: ${err.message}`));
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve({ code, signal, stderr: stderrOutput });
      } else {
        const tail = stderrOutput.slice(-1500).replace(/\n/g, ' | ');
        reject(new Error(`${label} exited with code ${code}, signal ${signal}${tail ? ': ' + tail : ''}`));
      }
    });
  });
}

/**
 * Build the upload-time normalization FFmpeg argument vector.
 * Heavy transcoding happens here, once, never live.
 */
function buildNormalizeFfmpegArgs(inputPath, outputPath) {
  return [
    '-y',
    '-i', inputPath,
    '-vf',
    'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=30',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-b:v', '4500k',
    '-maxrate', '5000k',
    '-bufsize', '9000k',
    '-g', '60',
    '-keyint_min', '60',
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    '-movflags', '+faststart',
    outputPath,
  ];
}

/**
 * Spawn FFmpeg under `nice` on Linux so normalization is deprioritized against
 * live streams, the API and Redis. On non-Linux (e.g. local dev) FFmpeg is
 * spawned directly because `nice` is unavailable.
 */
function spawnNormalizeFfmpeg(args) {
  if (process.platform === 'linux') {
    return spawnAndWait('nice', ['-n', String(Math.max(-20, Math.min(19, NORMALIZE_NICE_LEVEL))), 'ffmpeg', ...args], {
      label: 'ffmpeg-normalize',
    });
  }
  return spawnAndWait('ffmpeg', args, { label: 'ffmpeg-normalize' });
}

/**
 * Upload the normalized file to the active storage bucket. R2 objects are
 * streamed from disk (PutObject with a read stream) so large files never get
 * buffered in memory. Supabase Storage falls back to the buffer-based adapter
 * upload.
 */
async function uploadNormalizedFile(objectKey, filePath) {
  const stat = await fsp.stat(filePath);
  const provider = getStorageProvider('r2');
  if (provider?.s3Client) {
    const { bucket } = getR2Configuration();
    const stream = fs.createReadStream(filePath);
    await provider.s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: stream,
      ContentType: 'video/mp4',
      ContentLength: stat.size,
    }));
    return {
      key: objectKey,
      sizeBytes: stat.size,
      publicUrl: typeof provider.getPublicUrl === 'function' ? provider.getPublicUrl(objectKey) : null,
    };
  }
  // Supabase / buffer-based adapter path. Guard against very large files.
  const maxBufferBytes = Number(process.env.NORMALIZE_MAX_BUFFER_BYTES || '536870912'); // 512 MiB
  if (stat.size > maxBufferBytes) {
    throw new Error(`Normalized file (${stat.size} bytes) is too large for the buffer-based storage adapter. Configure Cloudflare R2 for large videos.`);
  }
  const buffer = await fsp.readFile(filePath);
  const result = await getStorageProvider().upload(objectKey, buffer, 'video/mp4');
  return {
    key: result.key || objectKey,
    sizeBytes: stat.size,
    publicUrl: result.publicUrl || null,
  };
}

// ---------------------------------------------------------------------------
// Asset catalog (uploaded_assets.json) + Supabase streams-table bookkeeping
// ---------------------------------------------------------------------------
function findAssetIndex(assets, assetKey, sourceUrl) {
  return assets.findIndex((asset) =>
    (assetKey && asset.key === assetKey)
    || (sourceUrl && (asset.url === sourceUrl || asset.publicUrl === sourceUrl))
  );
}

function normalizeAssetKeyForStream(videoUrl) {
  if (!videoUrl) return null;
  try {
    const url = new URL(videoUrl);
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return videoUrl.replace(/^\/+/, '');
  }
}

/**
 * Persist normalization progress on the uploaded-asset catalog and, when
 * Supabase is configured, on every stream row that references this video.
 */
async function markAssetStatus({ assetKey, sourceUrl, status, normalizedObjectKey, sizeBytes, error, streamId }) {
  const assets = readUploadedAssets();
  const index = findAssetIndex(assets, assetKey, sourceUrl);
  const now = new Date().toISOString();
  let asset = null;
  if (index !== -1) {
    asset = { ...assets[index] };
    asset.normalization_status = status;
    asset.normalized = status === 'ready';
    if (normalizedObjectKey) asset.normalized_object_key = normalizedObjectKey;
    if (sizeBytes !== undefined) asset.sizeBytes = sizeBytes;
    if (error) asset.normalization_error = error;
    asset.updatedAt = now;
    assets[index] = asset;
    writeUploadedAssets(assets);
  }

  if (SUPABASE_ADMIN_CONFIGURED && supabase) {
    const lookupKey = normalizedObjectKey || (assetKey ? normalizeAssetKeyForStream(sourceUrl || '') : null);
    const matchValue = lookupKey || sourceUrl;
    try {
      const update = {
        normalization_status: status,
        normalized: status === 'ready',
        normalization_error: error || null,
        updated_at: now,
      };
      if (normalizedObjectKey) update.normalized_object_key = normalizedObjectKey;
      if (status === 'failed') update.normalized_object_key = null;

      if (matchValue) {
        await supabase
          .from('streams')
          .update(update)
          .or(`video_url.eq.${encodeURIComponent(matchValue)},normalized_object_key.eq.${encodeURIComponent(String(normalizedObjectKey || ''))}`);
      }
    } catch (err) {
      console.error('[Normalize] Supabase stream-status update failed:', err.message);
    }
  }

  if (streamId) {
    try {
      await redisClient.publish('stream-telemetry-events', JSON.stringify({
        streamId,
        status: 'idle',
        normalization_status: status,
        normalized_object_key: normalizedObjectKey || null,
        normalization_error: error || null,
        timestamp: now,
      }));
      await redisClient.publish(`stream:telemetry:${streamId}`, JSON.stringify({
        streamId,
        normalization_status: status,
        normalized_object_key: normalizedObjectKey || null,
        normalization_error: error || null,
        timestamp: now,
      }));
    } catch {}
  }

  return asset;
/**
 * Normalize one video. Intended to be processed by normalizeWorker.js.
 * @param {Object} jobData
 * @param {string} jobData.sourceUrl - http(s) URL of the source video (R2/Supabase signed or public URL).
 * @param {string} [jobData.objectKey] - storage object key of the source.
 * @param {string} [jobData.assetKey] - catalog key of the uploaded asset.
 * @param {string} [jobData.streamId] - optional stream to notify.
 * @param {string} [jobData.userId]
 * @returns {Promise<{normalizedObjectKey: string, sizeBytes: number}>}
 */
export async function normalizeVideoJob(jobData) {
  const {
    sourceUrl, objectKey, assetKey, streamId, userId,
  } = jobData || {};
  if (!sourceUrl && !objectKey) {
    throw new Error('Normalization job requires a sourceUrl or objectKey.');
  }

  let slot = null;
  let renewTimer = null;
  let sourcePath = null;
  let outputPath = null;
  const sourceDisplay = objectKey || sourceUrl || '(unknown)';

  try {
    slot = await acquireNormalizeSlot();
    if (!slot) throw new Error('Normalization concurrency limit reached: no free normalization slot.');
    renewTimer = setInterval(() => void renewNormalizeSlot(slot), NORMALIZE_SLOT_RENEW_MS);
    if (renewTimer.unref) renewTimer.unref();

    console.log(`[Normalize] Starting normalization for ${sourceDisplay} (stream: ${streamId || '-'})`);

    await markAssetStatus({ assetKey, sourceUrl, status: 'processing', streamId });

    // Resolve a downloadable URL for the source.
    let downloadUrl = sourceUrl;
    if (!downloadUrl && objectKey) {
      const r2Provider = getStorageProvider('r2');
      if (r2Provider && typeof r2Provider.getSignedUrl === 'function') {
        downloadUrl = await r2Provider.getSignedUrl(objectKey, 3600);
      }
    }
    if (!downloadUrl) {
      throw new Error('No downloadable source URL available for normalization.');
    }

    sourcePath = path.join(TEMP_DIR, `streempulse-normalize-source-${randomUUID()}.mp4`);
    await downloadVideoToLocalFile(downloadUrl, sourcePath, {
      expectedBytes: undefined,
      maxBytes: Number(process.env.VIDEO_CACHE_MAX_FILE_BYTES) || 5_000_000_000,
    });

    const sourceStat = await fsp.stat(sourcePath);
    if (!sourceStat.size || sourceStat.size === 0) {
      throw new Error('Downloaded source video is empty.');
    }

    outputPath = path.join(TEMP_DIR, `streempulse-normalized-${randomUUID()}.mp4`);
    const ffmpegArgs = buildNormalizeFfmpegArgs(sourcePath, outputPath);
    await spawnNormalizeFfmpeg(ffmpegArgs);

    const outStat = await fsp.stat(outputPath);
    if (!outStat.size || outStat.size === 0) {
      throw new Error('Normalization produced an empty output file.');
    }

    const normalizedObjectKey = `${NORMALIZED_OBJECT_PREFIX}${Date.now()}-${randomUUID()}-${path.basename(outputPath)}`;
    const uploaded = await uploadNormalizedFile(normalizedObjectKey, outputPath);

    await markAssetStatus({
      assetKey, sourceUrl, status: 'ready', normalizedObjectKey: uploaded.key, sizeBytes: uploaded.sizeBytes, streamId,
    });

    console.log(`[Normalize] Ready: ${sourceDisplay} -> ${uploaded.key} (${uploaded.sizeBytes} bytes)`);
    return { normalizedObjectKey: uploaded.key, sizeBytes: uploaded.sizeBytes };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Normalize] Failed for ${sourceDisplay}: ${message}`);
    await markAssetStatus({ assetKey, sourceUrl, status: 'failed', error: message, streamId });
    throw error;
  } finally {
    if (renewTimer) clearInterval(renewTimer);
    if (slot) await slot.release();
    for (const file of [sourcePath, outputPath].filter(Boolean)) {
      try { await fsp.unlink(file).catch(() => {}); } catch {}
    }
  }
}

/**
 * BullMQ job processor entry point.
 * @param {import('bullmq').Job} job
 */
export async function processNormalizeJob(job) {
  return normalizeVideoJob(job.data);
}

// Allow direct invocation: node normalizeVideo.js <sourceUrl> [objectKey]
const mainModule = new URL(import.meta.url).pathname;
const invokedModule = process.argv[1] ? path.resolve(process.argv[1]).toLowerCase().replace(/\\/g, '/') : '';
if (invokedModule && mainModule.toLowerCase().replace(/\\/g, '/') === invokedModule) {
  const [sourceUrl, objectKey] = process.argv.slice(2);
  if (!sourceUrl) {
    console.error('Usage: node normalizeVideo.js <sourceUrl> [objectKey]');
    process.exit(1);
  }
  normalizeVideoJob({ sourceUrl, objectKey })
    .then((result) => { console.log('[Normalize] CLI done:', result); process.exit(0); })
    .catch((error) => { console.error('[Normalize] CLI failed:', error.message); process.exit(1); });
}
