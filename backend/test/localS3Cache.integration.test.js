import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { retryCachePreparation, getCacheFallbackReason } from '../cacheFallback.js';
import { downloadVideoToLocalFile } from '../localVideoSource.js';
import { acquireVideoCache } from '../videoCache.js';

const runIntegration = process.env.RUN_LOCAL_S3_INTEGRATION === '1';

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

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

test('local S3-compatible signed URL, cache retry, and direct-source fallback', {
  skip: !runIntegration && 'Set RUN_LOCAL_S3_INTEGRATION=1 with isolated loopback S3 test settings to run.',
}, async (t) => {
  let endpoint = process.env.LOCAL_S3_TEST_ENDPOINT;
  const s3rverModule = process.env.LOCAL_S3RVER_MODULE;
  const bucket = process.env.LOCAL_S3_TEST_BUCKET || (s3rverModule ? 'streempulse-test-local' : '');
  let accessKeyId = process.env.LOCAL_S3_TEST_ACCESS_KEY;
  let secretAccessKey = process.env.LOCAL_S3_TEST_SECRET_KEY;
  let localS3rver;
  let localS3rverDirectory;

  if (!endpoint && s3rverModule) {
    const require = createRequire(import.meta.url);
    const S3rver = require(s3rverModule);
    localS3rverDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'streempulse-s3rver-'));
    localS3rver = new S3rver({
      address: '127.0.0.1',
      port: 0,
      directory: localS3rverDirectory,
      resetOnClose: true,
      silent: true,
      configureBuckets: [{ name: bucket }],
    });
    const address = await localS3rver.run();
    endpoint = `http://127.0.0.1:${address.port}`;
    accessKeyId ||= 'S3RVER';
    secretAccessKey ||= 'S3RVER';
    t.after(async () => {
      await localS3rver.close().catch(() => {});
      await fs.rm(localS3rverDirectory, { recursive: true, force: true });
    });
  }

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    t.skip('Local S3 test endpoint, test bucket, and isolated test credentials are required.');
    return;
  }

  let parsedEndpoint;
  try { parsedEndpoint = new URL(endpoint); } catch { t.skip('LOCAL_S3_TEST_ENDPOINT is not a valid URL.'); return; }
  if (!['http:', 'https:'].includes(parsedEndpoint.protocol) || !isLoopbackHostname(parsedEndpoint.hostname)) {
    t.skip('Refusing to run: LOCAL_S3_TEST_ENDPOINT must point to a loopback host only.');
    return;
  }
  if (!bucket.startsWith('streempulse-test-')) {
    t.skip('Refusing to run: LOCAL_S3_TEST_BUCKET must use the streempulse-test- prefix.');
    return;
  }

  const client = new S3Client({
    region: 'us-east-1',
    endpoint,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId, secretAccessKey },
  });
  const objectKey = `integration/${randomUUID()}.mp4`;
  const payload = Buffer.from(`isolated local S3 media fixture ${randomUUID()}`);
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streempulse-local-s3-'));
  t.after(async () => {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })).catch(() => {});
    client.destroy();
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: payload, ContentType: 'video/mp4' }));
  const metadata = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  assert.equal(Number(metadata.ContentLength), payload.length);
  const identity = {
    provider: 'r2-local-integration',
    bucket,
    objectKey,
    etag: metadata.ETag,
    lastModified: metadata.LastModified?.toISOString(),
  };
  const makeSignedDownload = async () => {
    const signed = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: objectKey }), { expiresIn: 60 });
    return (destination, { signal, onProgress }) => downloadVideoToLocalFile(signed, destination, {
      expectedBytes: payload.length,
      signal,
      onProgress,
    });
  };

  // A normal signed GET is exercised via the actual downloader and shared cache.
  const goodResult = await retryCachePreparation({
    attempts: 1,
    prepare: async () => acquireVideoCache({
      redis: new FakeRedis(), cacheDir,
      identity,
      expectedBytes: payload.length,
      minFreeBytes: 0,
      download: await makeSignedDownload(),
    }),
  });
  assert.ok(goodResult.value);
  assert.deepEqual(await fs.readFile(goodResult.value.path), payload);
  await goodResult.value.release();

  let signAttempts = 0;
  const fallbackCacheDir = path.join(cacheDir, 'fallback');
  const cacheRetries = await retryCachePreparation({
    attempts: 2,
    waitBeforeRetry: async () => {},
    prepare: async () => {
      signAttempts++;
      const download = await makeSignedDownload();
      return acquireVideoCache({
        redis: new FakeRedis(), cacheDir: fallbackCacheDir,
        identity,
        expectedBytes: payload.length,
        maxFileBytes: payload.length - 1,
        minFreeBytes: 0,
        download,
      });
    },
  });
  assert.equal(cacheRetries.value, null);
  assert.equal(cacheRetries.attempts, 2);
  assert.equal(signAttempts, 2);

  const directUrl = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
    { expiresIn: 60 },
  );
  const response = await fetch(directUrl);
  assert.equal(response.ok, true);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
  assert.equal(getCacheFallbackReason(true), 'local-cache-unavailable');
  assert.equal(getCacheFallbackReason(false), 'source-version-unavailable');
});
