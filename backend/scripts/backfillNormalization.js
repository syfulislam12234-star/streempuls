/**
 * Backfill: enqueue upload-time normalization for every video in the media
 * catalog that is not yet normalized (pending / failed / missing). The queue
 * enforces max 2 concurrent jobs (Redis slot lock + normalizeWorker.js), so
 * this runs "one or two at a time".
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '..', '..', 'data');
const UPLOADED_ASSETS_FILE = path.join(DATA_DIR, 'uploaded_assets.json');

const { normalizeQueue } = await import('../queue.js');
const { normalizeVideoJob } = await import('../normalizeVideo.js');

function readUploadedAssets() {
  try {
    return JSON.parse(fs.readFileSync(UPLOADED_ASSETS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function main() {
  const assets = Array.isArray(readUploadedAssets()) ? readUploadedAssets() : [];
  const queued = [];
  const skipped = [];
  let failed = 0;

  for (const asset of assets) {
    if (asset.status !== 'confirmed') continue;
    const isReady = asset.normalization_status === 'ready';
    const isProcessing = asset.normalization_status === 'processing';
    if (isReady && asset.normalized) {
      skipped.push({ key: asset.key, status: 'already-ready' });
      continue;
    }
    if (isProcessing) {
      skipped.push({ key: asset.key, status: 'processing' });
      continue;
    }
    try {
      await normalizeQueue.add(
        'normalize-video',
        {
          sourceUrl: asset.url,
          objectKey: asset.key,
          assetKey: asset.key,
          userId: asset.ownerUserId || null,
        },
        { jobId: `backfill-normalize-${asset.key}`, jobTimeout: 3600000 }
      );
      queued.push({ key: asset.key, normalization_status: 'pending' });
      console.log(`[Backfill] Queued normalization for ${asset.key}`);
    } catch (error) {
      failed += 1;
      console.error(`[Backfill] Could not queue ${asset.key}:`, error.message);
    }
  }

  console.log(`[Backfill] Done. queued=${queued.length} skipped=${skipped.length} failed=${failed}`);
  process.exit(0);
}

main().catch((error) => {
  console.error('[Backfill] Fatal:', error);
  process.exit(1);
});
