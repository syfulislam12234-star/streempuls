import assert from 'node:assert/strict';
import test from 'node:test';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { CloudflareR2StorageAdapter } from '../storage.js';
import { normalizeR2ObjectKey, parseR2ObjectUrl } from '../r2ObjectUrl.js';

const bucket = 'stream-assets';
const endpoint = 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';

test('parses path-style signed R2 URLs into the configured bucket and exact object key', () => {
  const result = parseR2ObjectUrl(
    `https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/${bucket}/media/ambient%20loop.mp4?X-Amz-Signature=redacted`,
    { bucket, endpoint },
  );
  assert.deepEqual(result, { bucket, key: 'media/ambient loop.mp4' });
});

test('parses bucket-host and configured public-domain R2 URLs without removing key segments', () => {
  assert.deepEqual(
    parseR2ObjectUrl(`https://${bucket}.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/media/${bucket}/clip.mp4`, { bucket, endpoint }),
    { bucket, key: `media/${bucket}/clip.mp4` },
  );
  assert.deepEqual(
    parseR2ObjectUrl('https://cdn.example.test/media/clip.mp4', { bucket, endpoint, publicDomain: 'https://cdn.example.test' }),
    { bucket, key: 'media/clip.mp4' },
  );
});

test('requires an exact path-style bucket segment and does not guess away prefixes', () => {
  assert.deepEqual(
    parseR2ObjectUrl(`${endpoint}/${bucket}/media/clip.mp4`, { bucket, endpoint, publicDomain: endpoint }),
    { bucket, key: 'media/clip.mp4' },
  );
  assert.throws(
    () => parseR2ObjectUrl(`${endpoint}/another-bucket/media/clip.mp4`, { bucket, endpoint, publicDomain: endpoint }),
    /configured bucket/i,
  );
  assert.equal(normalizeR2ObjectKey('media/stream-assets/clip.mp4', bucket), 'media/stream-assets/clip.mp4');
  assert.equal(normalizeR2ObjectKey(`${bucket}/media/clip.mp4`, bucket), 'media/clip.mp4');
});

test('rejects unknown object URL hosts rather than treating their path as an R2 key', () => {
  assert.equal(parseR2ObjectUrl('https://unrelated.example/media/clip.mp4', { bucket, endpoint }), null);
});

test('HEAD verification uses the exact configured bucket and key', async () => {
  const adapter = new CloudflareR2StorageAdapter();
  await adapter.ensureInitialized();
  adapter.bucket = bucket;
  let receivedCommand;
  adapter.s3Client = {
    send: async (command) => {
      receivedCommand = command;
      return { ContentLength: 2048, ContentType: 'video/mp4' };
    },
  };

  const metadata = await adapter.headObject('media/clip.mp4');
  assert.ok(receivedCommand instanceof HeadObjectCommand);
  assert.deepEqual(receivedCommand.input, { Bucket: bucket, Key: 'media/clip.mp4' });
  assert.equal(metadata.ContentLength, 2048);
});

test('does not expose object keys or signed query strings in R2 HEAD errors', async () => {
  const adapter = new CloudflareR2StorageAdapter();
  await adapter.ensureInitialized();
  adapter.bucket = bucket;
  adapter.s3Client = { send: async () => { throw new Error('signed-url-secret'); } };

  await assert.rejects(adapter.headObject('media/private.mp4'), (error) => {
    assert.match(error.message, /could not be verified/i);
    assert.doesNotMatch(error.message, /private\.mp4|signed-url-secret/);
    return true;
  });
});
