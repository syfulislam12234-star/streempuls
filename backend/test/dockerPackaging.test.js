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

  assert.match(rootApi, /COPY backend\/ \.\/backend\//, 'root API image copies the complete backend tree');
  assertCopied(rootWorker, [
    'backend/r2ObjectUrl.js',
    'backend/streamDestinations.js',
    'backend/redisLease.js',
    'backend/streamLeaseRunner.js',
    'backend/streamDiagnostics.js',
    'backend/streamOwnership.js',
  ]);
  assertCopied(backendApi, ['streamDestinations.js', 'streamStart.js', 'redisLease.js']);
  assertCopied(backendWorker, [
    'r2ObjectUrl.js',
    'streamDestinations.js',
    'redisLease.js',
    'streamLeaseRunner.js',
    'streamDiagnostics.js',
    'streamOwnership.js',
  ]);
});
