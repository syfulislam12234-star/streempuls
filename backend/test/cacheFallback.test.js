import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { retryCachePreparation, getCacheFallbackReason } from '../cacheFallback.js';
import { downloadVideoToLocalFile } from '../localVideoSource.js';
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

async function localServer(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/media`;
}

test('cache preparation retries a local R2-like failure and succeeds without a partial artifact', async (t) => {
  const payload = Buffer.from('local test video fixture');
  let requests = 0;
  const url = await localServer(t, (_request, response) => {
    requests++;
    if (requests === 1) {
      response.writeHead(503);
      response.end('temporary failure');
      return;
    }
    response.writeHead(200, { 'content-length': payload.length });
    response.end(payload);
  });
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streempulse-fallback-retry-'));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const result = await retryCachePreparation({
    attempts: 2,
    waitBeforeRetry: async () => {},
    prepare: () => acquireVideoCache({
      redis: new FakeRedis(),
      cacheDir,
      identity: { provider: 'r2-test', bucket: 'local', objectKey: 'fixture.mp4', etag: 'version-1' },
      expectedBytes: payload.length,
      minFreeBytes: 0,
      download: (destination, { signal, onProgress }) => downloadVideoToLocalFile(url, destination, {
        expectedBytes: payload.length,
        signal,
        onProgress,
      }),
    }),
  });

  assert.equal(result.cancelled, false);
  assert.equal(result.attempts, 2);
  assert.equal(requests, 2);
  assert.ok(result.value);
  assert.deepEqual(await fs.readFile(result.value.path), payload);
  await result.value.release();
  assert.equal(getCacheFallbackReason(true), 'local-cache-unavailable');
});

test('after cache retries fail, a fake provider can supply a reachable direct source with a precise reason', async (t) => {
  const fallbackPayload = Buffer.from('direct-input-fixture');
  let requests = 0;
  const directUrl = await localServer(t, (_request, response) => {
    requests++;
    if (requests <= 2) {
      response.writeHead(503);
      response.end('unavailable');
      return;
    }
    response.writeHead(200, { 'content-length': fallbackPayload.length });
    response.end(fallbackPayload);
  });
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streempulse-fallback-direct-'));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const provider = { getSignedUrl: async () => directUrl };
  const result = await retryCachePreparation({
    attempts: 2,
    waitBeforeRetry: async () => {},
    prepare: () => acquireVideoCache({
      redis: new FakeRedis(),
      cacheDir,
      identity: { provider: 'r2-test', bucket: 'local', objectKey: 'fixture.mp4', etag: 'version-1' },
      expectedBytes: 16,
      minFreeBytes: 0,
      download: (destination, { signal }) => downloadVideoToLocalFile(directUrl, destination, {
        expectedBytes: 16,
        signal,
      }),
    }),
  });

  assert.equal(result.value, null);
  assert.equal(result.cancelled, false);
  assert.equal(result.attempts, 2);
  const fallbackInput = await provider.getSignedUrl();
  assert.equal(fallbackInput, directUrl);
  assert.equal(requests, 2);
  const directResponse = await fetch(fallbackInput);
  assert.equal(directResponse.ok, true);
  assert.deepEqual(Buffer.from(await directResponse.arrayBuffer()), fallbackPayload);
  assert.equal(requests, 3);
  assert.equal(getCacheFallbackReason(true), 'local-cache-unavailable');
  assert.equal(getCacheFallbackReason(false), 'source-version-unavailable');
});

test('cache preparation cancellation stops retries immediately', async () => {
  let attempts = 0;
  const result = await retryCachePreparation({
    attempts: 3,
    shouldAbort: () => true,
    prepare: async () => { attempts++; },
  });
  assert.deepEqual(result, { value: null, lastError: null, attempts: 0, cancelled: true });
  assert.equal(attempts, 0);
});
