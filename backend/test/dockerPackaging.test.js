import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function assertCopied(dockerfile, files) {
  for (const file of files) {
    assert.match(dockerfile, new RegExp(`(?:^|\\s)${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`), `${file} must be copied into the image`);
  }
}

test('every tracked Docker deployment image receives the helpers it imports', () => {
  const rootApi = readProjectFile('Dockerfile.api');
  const rootWorker = readProjectFile('Dockerfile.worker');
  const backendApi = readProjectFile('backend/Dockerfile.api');
  const backendWorker = readProjectFile('backend/Dockerfile.worker');
  const rootCompose = readProjectFile('docker-compose.yml');
  const backendCompose = readProjectFile('backend/docker-compose.yml');
  const rootDockerIgnore = readProjectFile('.dockerignore');
  const backendDockerIgnore = readProjectFile('backend/.dockerignore');

  assert.match(rootApi, /COPY backend\/ \.\/backend\//, 'root API image copies the complete backend tree');
  assertCopied(rootWorker, [
    'backend/r2ObjectUrl.js',
    'backend/streamDestinations.js',
    'backend/redisLease.js',
    'backend/streamLeaseRunner.js',
    'backend/streamDiagnostics.js',
    'backend/streamOwnership.js',
    'backend/localVideoSource.js',
    'backend/videoCache.js',
    'backend/ffmpegProgress.js',
    'backend/workerShutdown.js',
    'backend/ffmpegLifecycle.js',
    'backend/cacheFallback.js',
  ]);
  assert.match(rootWorker, /COPY uploads\/sample_lofi_broadcast_1080p60\.mp4 \.\/uploads\/sample_lofi_broadcast_1080p60\.mp4/);
  assertCopied(backendApi, ['streamDestinations.js', 'streamAccess.js', 'streamPersistence.js', 'streamStart.js', 'redisLease.js']);
  assertCopied(backendWorker, [
    'r2ObjectUrl.js',
    'streamDestinations.js',
    'redisLease.js',
    'streamLeaseRunner.js',
    'streamDiagnostics.js',
    'streamOwnership.js',
    'localVideoSource.js',
    'videoCache.js',
    'ffmpegProgress.js',
    'workerShutdown.js',
    'ffmpegLifecycle.js',
    'cacheFallback.js',
  ]);
  assert.match(rootCompose, /UPLOADS_DIR=\/app\/uploads/);
  assert.match(backendCompose, /UPLOADS_DIR=\/app\/uploads/);
  assert.match(rootCompose, /video-cache:\/app\/video-cache/);
  assert.match(backendCompose, /video-cache:\/app\/video-cache/);
  assert.match(rootCompose, /VIDEO_CACHE_DOWNLOAD_CONCURRENCY=2/);
  assert.match(backendCompose, /VIDEO_CACHE_DOWNLOAD_CONCURRENCY=2/);
  assert.match(rootCompose, /stop_grace_period:\s*30s/);
  assert.match(backendCompose, /stop_grace_period:\s*30s/);
  assert.match(backendCompose, /\.\.\/uploads\/sample_lofi_broadcast_1080p60\.mp4:\/app\/uploads\/sample_lofi_broadcast_1080p60\.mp4:ro/);
  assert.match(rootDockerIgnore, /^\*\*\/\.env$/m);
  assert.match(rootDockerIgnore, /^\*\*\/\.env\.\*$/m);
  assert.match(backendDockerIgnore, /^\*\*\/\.env$/m);
  assert.match(backendDockerIgnore, /^\*\*\/\.env\.\*$/m);
});
