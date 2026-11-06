import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stopStreamsThenClose } from '../workerShutdown.js';
import { acquireVideoCache } from '../videoCache.js';

class FakeRedis {
  constructor() { this.values = new Map(); }
  async set(key, token, _mode, ttl) {
    const current = this.values.get(key);
    if (current && current.expiresAt > Date.now()) return null;
    this.values.set(key, { token, expiresAt: Date.now() + Number(ttl) });
    return 'OK';
  }
  async eval(script, _keyCount, key, token, ttl) {
    const current = this.values.get(key);
    if (!current || current.token !== token || current.expiresAt <= Date.now()) return 0;
    if (script.includes('PEXPIRE')) {
      current.expiresAt = Date.now() + Number(ttl);
      return 1;
    }
    this.values.delete(key);
    return 1;
  }
}

test('worker shutdown stops every stream before closing worker resources', async () => {
  const events = [];
  const closed = await stopStreamsThenClose({
    streamIds: ['stream-a', 'stream-b'],
    stopStream: async (streamId) => {
      events.push(`stop:${streamId}`);
      return true;
    },
    closeResources: async () => { events.push('close'); },
  });

  assert.equal(closed, true);
  assert.deepEqual(events, ['stop:stream-a', 'stop:stream-b', 'close']);
});

test('worker shutdown retains connections if any stream stop is unconfirmed', async () => {
  let closeCount = 0;
  const closed = await stopStreamsThenClose({
    streamIds: ['stream-running', 'stream-uncertain'],
    stopStream: async (streamId) => streamId === 'stream-running',
    closeResources: async () => { closeCount++; },
  });

  assert.equal(closed, false);
  assert.equal(closeCount, 0);
});

test('worker shutdown still closes resources when there are no active streams', async () => {
  let closeCount = 0;
  const closed = await stopStreamsThenClose({
    streamIds: [],
    stopStream: async () => true,
    closeResources: async () => { closeCount++; },
  });

  assert.equal(closed, true);
  assert.equal(closeCount, 1);
});

test('cache entry becomes evictable after the confirmed worker stop releases its usage lease', async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streempulse-shutdown-cache-'));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const redis = new FakeRedis();
  const previousLimit = process.env.VIDEO_CACHE_MAX_BYTES;
  process.env.VIDEO_CACHE_MAX_BYTES = '40';
  t.after(() => {
    if (previousLimit === undefined) delete process.env.VIDEO_CACHE_MAX_BYTES;
    else process.env.VIDEO_CACHE_MAX_BYTES = previousLimit;
  });
  const identity = { provider: 'r2', bucket: 'test', objectKey: 'same.mp4', etag: 'v1' };
  const acquire = (objectKey) => acquireVideoCache({
    redis,
    cacheDir,
    identity: { ...identity, objectKey },
    expectedBytes: 32,
    minFreeBytes: 0,
    download: (destination) => fs.writeFile(destination, Buffer.alloc(32)),
  });
  const cached = await acquire('same.mp4');
  let childExited = false;
  const stopped = await stopStreamsThenClose({
    streamIds: ['stream-with-cache'],
    stopStream: async () => {
      childExited = true;
      await cached.release();
      return childExited;
    },
    closeResources: async () => {},
  });

  assert.equal(stopped, true);
  const replacement = await acquire('replacement.mp4');
  assert.equal((await fs.stat(replacement.path)).size, 32);
  await replacement.release();
});
