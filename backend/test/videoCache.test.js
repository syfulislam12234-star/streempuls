import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireVideoCache, cleanupOrphanedVideoCacheFiles, createInProcessCacheLockProvider, reapCacheUsageLeases } from '../videoCache.js';

class FakeRedis {
  constructor() { this.values = new Map(); }
  async set(key, token, mode, ttl, nx) {
    assert.equal(mode, 'PX');
    assert.equal(nx, 'NX');
    const current = this.values.get(key);
    if (current && current.expiresAt > Date.now()) return null;
    this.values.set(key, { token, expiresAt: Date.now() + Number(ttl) });
    return 'OK';
  }
  async eval(script, keyCount, key, token, ttl) {
    assert.equal(keyCount, 1);
    const current = this.values.get(key);
    if (!current || current.token !== token || current.expiresAt <= Date.now()) return 0;
    if (script.includes('PEXPIRE')) {
      current.expiresAt = Date.now() + Number(ttl);
      return 1;
    }
    if (script.includes('DEL')) {
      this.values.delete(key);
      return 1;
    }
    throw new Error('Unexpected lock command');
  }
}

async function temporaryCache(t, name) {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), `streempulse-${name}-`));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  return cacheDir;
}

const identity = {
  provider: 'r2',
  bucket: 'test-bucket',
  objectKey: 'media/test-video.mp4',
  etag: 'etag-test',
  expectedBytes: 32,
};

function downloader(body, counter = { count: 0 }) {
  return async (destinationPath, { onProgress }) => {
    counter.count++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(destinationPath, body);
    onProgress?.(body.length, body.length);
  };
}

test('in-process cache locks use a namespaced key and release it safely', async () => {
  const firstProvider = createInProcessCacheLockProvider();
  const secondProvider = createInProcessCacheLockProvider();
  assert.match(firstProvider.namespace, /^streempulse:video-cache:local:/);
  assert.notEqual(firstProvider.namespace, secondProvider.namespace);
  const firstLease = await firstProvider.acquire(`${firstProvider.namespace}:entry`);
  assert.ok(firstLease);
  assert.equal(await firstProvider.acquire(`${firstProvider.namespace}:entry`), null);
  assert.ok(await firstLease.release());
  assert.ok(await firstProvider.acquire(`${firstProvider.namespace}:entry`));
});

test('cache is reused for a source/version and verified before reuse', async (t) => {
  const cacheDir = await temporaryCache(t, 'video-cache');
  const redis = new FakeRedis();
  const body = Buffer.alloc(identity.expectedBytes, 7);
  const downloads = { count: 0 };
  const first = await acquireVideoCache({
    redis, cacheDir, identity, expectedBytes: body.length, minFreeBytes: 0,
    download: downloader(body, downloads),
  });
  assert.equal(first.cacheHit, false);
  await first.release();

  const second = await acquireVideoCache({
    redis, cacheDir, identity, expectedBytes: body.length, minFreeBytes: 0,
    download: downloader(body, downloads),
  });
  assert.equal(second.cacheHit, true);
  assert.equal(second.path, first.path);
  assert.equal(downloads.count, 1);
  await second.release();

  await fs.writeFile(first.path, Buffer.alloc(body.length, 9));
  const repaired = await acquireVideoCache({
    redis, cacheDir, identity, expectedBytes: body.length, minFreeBytes: 0,
    download: downloader(body, downloads),
  });
  assert.equal(repaired.cacheHit, false);
  assert.equal(downloads.count, 2);
  assert.deepEqual(await fs.readFile(repaired.path), body);
  await repaired.release();

  const updatedVersion = await acquireVideoCache({
    redis,
    cacheDir,
    identity: { ...identity, etag: 'etag-updated' },
    expectedBytes: body.length,
    minFreeBytes: 0,
    download: downloader(Buffer.alloc(body.length, 8), downloads),
  });
  assert.equal(updatedVersion.cacheHit, false);
  assert.equal(downloads.count, 3);
  assert.equal(updatedVersion.path, first.path, 'changed source version replaces the one object cache entry');
  assert.equal((await fs.readdir(cacheDir)).filter((name) => name.endsWith('.media')).length, 1);
  await updatedVersion.release();
});

test('concurrent requests for the same video perform one download and share one cache file', async (t) => {
  const cacheDir = await temporaryCache(t, 'video-cache-race');
  const redis = new FakeRedis();
  const body = Buffer.alloc(identity.expectedBytes, 4);
  const downloads = { count: 0 };
  const options = {
    redis, cacheDir, identity, expectedBytes: body.length, minFreeBytes: 0,
    download: downloader(body, downloads),
  };
  const [first, second] = await Promise.all([
    acquireVideoCache(options),
    acquireVideoCache(options),
  ]);
  assert.equal(downloads.count, 1);
  assert.equal(first.path, second.path);
  assert.deepEqual((await fs.readdir(cacheDir)).filter((name) => name.endsWith('.media')).length, 1);
  await Promise.all([first.release(), second.release()]);
});

test('cancelling while cache preparation is downloading removes temporary files and reservations', async (t) => {
  const cacheDir = await temporaryCache(t, 'video-cache-cancel-download');
  const redis = new FakeRedis();
  const controller = new AbortController();
  let downloadStarted;
  const started = new Promise((resolve) => { downloadStarted = resolve; });
  const pending = acquireVideoCache({
    redis,
    cacheDir,
    identity,
    expectedBytes: identity.expectedBytes,
    minFreeBytes: 0,
    signal: controller.signal,
    download: (_destinationPath, { signal }) => new Promise((_resolve, reject) => {
      downloadStarted();
      signal.addEventListener('abort', () => reject(new Error('download aborted')), { once: true });
    }),
  });

  await started;
  controller.abort();
  await assert.rejects(pending, /cancelled|aborted/i);
  const entries = await fs.readdir(cacheDir, { recursive: true });
  assert.equal(entries.some((name) => String(name).includes('.part-')), false);
  assert.equal(entries.some((name) => String(name).endsWith('.media') || String(name).endsWith('.json')), false);
  assert.deepEqual(await fs.readdir(path.join(cacheDir, '.reservations')), []);
  await assert.rejects(fs.access(path.join(cacheDir, '.leases')), { code: 'ENOENT' });
});

test('one stream releasing does not make a shared cache entry evictable while another still uses it', async (t) => {
  const cacheDir = await temporaryCache(t, 'video-cache-refcount');
  const redis = new FakeRedis();
  const previousLimit = process.env.VIDEO_CACHE_MAX_BYTES;
  process.env.VIDEO_CACHE_MAX_BYTES = '40';
  t.after(() => {
    if (previousLimit === undefined) delete process.env.VIDEO_CACHE_MAX_BYTES;
    else process.env.VIDEO_CACHE_MAX_BYTES = previousLimit;
  });
  const body = Buffer.alloc(identity.expectedBytes, 5);
  const options = {
    redis, cacheDir, identity, expectedBytes: body.length, minFreeBytes: 0,
    download: downloader(body),
  };
  const [first, second] = await Promise.all([
    acquireVideoCache(options),
    acquireVideoCache(options),
  ]);

  await first.release();
  await assert.rejects(acquireVideoCache({
    redis,
    cacheDir,
    identity: { ...identity, objectKey: 'media/another-stream.mp4' },
    expectedBytes: body.length,
    minFreeBytes: 0,
    download: downloader(body),
  }), /currently in use/i);
  assert.equal((await fs.stat(second.path)).size, body.length);

  await second.release();
  const next = await acquireVideoCache({
    redis,
    cacheDir,
    identity: { ...identity, objectKey: 'media/another-stream.mp4' },
    expectedBytes: body.length,
    minFreeBytes: 0,
    download: downloader(body),
  });
  assert.equal((await fs.stat(next.path)).size, body.length);
  await next.release();
});

test('cache eviction never deletes a file while a stream holds a usage lease', async (t) => {
  const cacheDir = await temporaryCache(t, 'video-cache-in-use');
  const redis = new FakeRedis();
  const previousLimit = process.env.VIDEO_CACHE_MAX_BYTES;
  process.env.VIDEO_CACHE_MAX_BYTES = '40';
  t.after(() => {
    if (previousLimit === undefined) delete process.env.VIDEO_CACHE_MAX_BYTES;
    else process.env.VIDEO_CACHE_MAX_BYTES = previousLimit;
  });
  const body = Buffer.alloc(identity.expectedBytes, 3);
  const active = await acquireVideoCache({
    redis, cacheDir, identity, expectedBytes: body.length, minFreeBytes: 0,
    download: downloader(body),
  });

  await assert.rejects(acquireVideoCache({
    redis,
    cacheDir,
    identity: { ...identity, objectKey: 'media/second.mp4' },
    expectedBytes: body.length,
    minFreeBytes: 0,
    download: downloader(body),
  }), /currently in use/i);
  assert.equal((await fs.stat(active.path)).size, body.length);
  await active.release();
});

test('a stale usage lease is not treated as proof that FFmpeg stopped', async (t) => {
  const cacheDir = await temporaryCache(t, 'video-cache-stale-lease');
  const redis = new FakeRedis();
  const previousLimit = process.env.VIDEO_CACHE_MAX_BYTES;
  process.env.VIDEO_CACHE_MAX_BYTES = '40';
  t.after(() => {
    if (previousLimit === undefined) delete process.env.VIDEO_CACHE_MAX_BYTES;
    else process.env.VIDEO_CACHE_MAX_BYTES = previousLimit;
  });
  const body = Buffer.alloc(identity.expectedBytes, 6);
  const active = await acquireVideoCache({
    redis, cacheDir, identity, expectedBytes: body.length, minFreeBytes: 0,
    download: downloader(body),
  });
  const leaseDirectory = path.join(cacheDir, '.leases', active.cacheId);
  const [leaseName] = await fs.readdir(leaseDirectory);
  const leasePath = path.join(leaseDirectory, leaseName);
  await fs.utimes(leasePath, new Date(0), new Date(0));

  await assert.rejects(acquireVideoCache({
    redis,
    cacheDir,
    identity: { ...identity, objectKey: 'media/second.mp4' },
    expectedBytes: body.length,
    minFreeBytes: 0,
    download: downloader(body),
  }), /currently in use/i);
  assert.equal((await fs.stat(active.path)).size, body.length);
});

test('lease reaper fails closed without exact-container termination proof', async (t) => {
  const cacheDir = await temporaryCache(t, 'video-cache-no-reaper-proof');
  const previousContainerId = process.env.WORKER_CONTAINER_ID;
  process.env.WORKER_CONTAINER_ID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  t.after(() => {
    if (previousContainerId === undefined) delete process.env.WORKER_CONTAINER_ID;
    else process.env.WORKER_CONTAINER_ID = previousContainerId;
  });
  const cacheEntry = await acquireVideoCache({
    redis: new FakeRedis(), cacheDir, identity, expectedBytes: identity.expectedBytes, minFreeBytes: 0,
    download: downloader(Buffer.alloc(identity.expectedBytes, 1)),
  });
  const leaseDirectory = path.join(cacheDir, '.leases', cacheEntry.cacheId);
  const [leaseName] = await fs.readdir(leaseDirectory);
  const leasePath = path.join(leaseDirectory, leaseName);
  await fs.utimes(leasePath, new Date(0), new Date(0));

  const result = await reapCacheUsageLeases(cacheDir, {
    lockProvider: { namespace: 'test-cache' },
  });
  assert.deepEqual(result, { reaped: 0, skipped: 0 });
  assert.equal((await fs.readdir(leaseDirectory)).length, 1);
  await cacheEntry.release();
});

test('lease reaper locks the cache entry and removes only an exactly verified exited container lease', async (t) => {
  const cacheDir = await temporaryCache(t, 'video-cache-reaper');
  const previousContainerId = process.env.WORKER_CONTAINER_ID;
  const containerId = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  process.env.WORKER_CONTAINER_ID = containerId;
  t.after(() => {
    if (previousContainerId === undefined) delete process.env.WORKER_CONTAINER_ID;
    else process.env.WORKER_CONTAINER_ID = previousContainerId;
  });
  const cacheEntry = await acquireVideoCache({
    redis: new FakeRedis(), cacheDir, identity, expectedBytes: identity.expectedBytes, minFreeBytes: 0,
    download: downloader(Buffer.alloc(identity.expectedBytes, 2)),
  });
  const leaseDirectory = path.join(cacheDir, '.leases', cacheEntry.cacheId);
  const [leaseName] = await fs.readdir(leaseDirectory);
  const leasePath = path.join(leaseDirectory, leaseName);
  const held = new Set();
  const lockProvider = {
    namespace: 'test-cache',
    async acquire(key) {
      assert.equal(held.has(key), false);
      held.add(key);
      return { release: async () => { held.delete(key); } };
    },
  };

  const result = await reapCacheUsageLeases(cacheDir, {
    lockProvider,
    verifyContainerExited: async (requestedId) => {
      assert.ok([...held].includes(`${lockProvider.namespace}:${cacheEntry.cacheId}`));
      assert.equal(requestedId, containerId);
      return { requestedId, containerId, state: 'exited', running: false };
    },
  });

  assert.deepEqual(result, { reaped: 1, skipped: 0 });
  assert.deepEqual(await fs.readdir(leaseDirectory), []);
  await cacheEntry.release();
});

test('lease reaper retains a lease when container identity does not match or remains running', async (t) => {
  const cacheDir = await temporaryCache(t, 'video-cache-reaper-running');
  const previousContainerId = process.env.WORKER_CONTAINER_ID;
  const containerId = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
  process.env.WORKER_CONTAINER_ID = containerId;
  t.after(() => {
    if (previousContainerId === undefined) delete process.env.WORKER_CONTAINER_ID;
    else process.env.WORKER_CONTAINER_ID = previousContainerId;
  });
  const cacheEntry = await acquireVideoCache({
    redis: new FakeRedis(), cacheDir, identity, expectedBytes: identity.expectedBytes, minFreeBytes: 0,
    download: downloader(Buffer.alloc(identity.expectedBytes, 3)),
  });
  const leaseDirectory = path.join(cacheDir, '.leases', cacheEntry.cacheId);
  const verifyContainerExited = async (requestedId) => ({
    requestedId,
    containerId: '0'.repeat(64),
    state: 'running',
    running: true,
  });
  const result = await reapCacheUsageLeases(cacheDir, {
    lockProvider: createInProcessCacheLockProvider(),
    verifyContainerExited,
  });
  assert.deepEqual(result, { reaped: 0, skipped: 1 });
  assert.equal((await fs.readdir(leaseDirectory)).length, 1);
  await cacheEntry.release();
});

test('lease reaper accepts a short container hostname only when runtime resolves its exact full ID', async (t) => {
  const cacheDir = await temporaryCache(t, 'video-cache-reaper-short-id');
  const previousContainerId = process.env.WORKER_CONTAINER_ID;
  const fullContainerId = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const shortContainerId = fullContainerId.slice(0, 12);
  process.env.WORKER_CONTAINER_ID = shortContainerId;
  t.after(() => {
    if (previousContainerId === undefined) delete process.env.WORKER_CONTAINER_ID;
    else process.env.WORKER_CONTAINER_ID = previousContainerId;
  });
  const cacheEntry = await acquireVideoCache({
    redis: new FakeRedis(), cacheDir, identity, expectedBytes: identity.expectedBytes, minFreeBytes: 0,
    download: downloader(Buffer.alloc(identity.expectedBytes, 4)),
  });
  const result = await reapCacheUsageLeases(cacheDir, {
    lockProvider: createInProcessCacheLockProvider(),
    verifyContainerExited: async (requestedId) => ({
      requestedId,
      containerId: fullContainerId,
      state: 'exited',
      running: false,
    }),
  });
  assert.deepEqual(result, { reaped: 1, skipped: 0 });
  await cacheEntry.release();
});

test('cache eviction removes an unused least-recently-used file when capacity is reached', async (t) => {
  const cacheDir = await temporaryCache(t, 'video-cache-eviction');
  const redis = new FakeRedis();
  const previousLimit = process.env.VIDEO_CACHE_MAX_BYTES;
  process.env.VIDEO_CACHE_MAX_BYTES = '40';
  t.after(() => {
    if (previousLimit === undefined) delete process.env.VIDEO_CACHE_MAX_BYTES;
    else process.env.VIDEO_CACHE_MAX_BYTES = previousLimit;
  });
  const body = Buffer.alloc(identity.expectedBytes, 2);
  const first = await acquireVideoCache({
    redis, cacheDir, identity, expectedBytes: body.length, minFreeBytes: 0,
    download: downloader(body),
  });
  await first.release();
  const second = await acquireVideoCache({
    redis,
    cacheDir,
    identity: { ...identity, objectKey: 'media/second.mp4' },
    expectedBytes: body.length,
    minFreeBytes: 0,
    download: downloader(body),
  });
  assert.equal((await fs.stat(second.path)).size, body.length);
  await assert.rejects(fs.access(first.path), { code: 'ENOENT' });
  await second.release();
});

test('orphaned incomplete cache files are removed only after the age threshold', async (t) => {
  const cacheDir = await temporaryCache(t, 'video-cache-orphans');
  const partial = path.join(cacheDir, `${'a'.repeat(64)}.media.part-abandoned`);
  await fs.writeFile(partial, 'partial');
  await fs.utimes(partial, new Date(0), new Date(0));
  assert.equal(await cleanupOrphanedVideoCacheFiles(cacheDir, { redis: new FakeRedis(), olderThanMs: 1000 }), 1);
  await assert.rejects(fs.access(partial), { code: 'ENOENT' });
});
