import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveLocalUpload } from '../localVideoSource.js';

test('resolves an API /uploads URL under the worker uploads directory', (t) => {
  const uploadsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'streempuls-worker-uploads-'));
  t.after(() => fs.rmSync(uploadsDirectory, { recursive: true, force: true }));
  const filePath = path.join(uploadsDirectory, 'sample video.mp4');
  fs.writeFileSync(filePath, 'test video');

  assert.equal(resolveLocalUpload('/uploads/sample%20video.mp4?preview=1', uploadsDirectory), filePath);
  assert.equal(resolveLocalUpload('/storage/media/clip.mp4', uploadsDirectory), null);
});

test('rejects missing local uploads and path traversal', (t) => {
  const uploadsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'streempuls-worker-uploads-'));
  t.after(() => fs.rmSync(uploadsDirectory, { recursive: true, force: true }));

  assert.throws(
    () => resolveLocalUpload('/uploads/missing.mp4', uploadsDirectory),
    /unavailable in the worker container/i,
  );
  assert.throws(
    () => resolveLocalUpload('/uploads/%2e%2e/secret.mp4', uploadsDirectory),
    /path is invalid/i,
  );
});