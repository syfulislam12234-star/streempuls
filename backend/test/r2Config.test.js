import assert from 'node:assert/strict';
import test from 'node:test';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getR2Configuration } from '../r2Config.js';

const validAccount = '0123456789abcdef0123456789abcdef';
const validCanonicalEnv = {
  CLOUDFLARE_R2_ACCOUNT_ID: validAccount,
  CLOUDFLARE_R2_ACCESS_KEY_ID: 'canonical-access-key',
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'canonical-secret-key',
};

test('prefers Cloudflare credential names and derives the default R2 endpoint', () => {
  const config = getR2Configuration({
    ...validCanonicalEnv,
    AWS_ACCESS_KEY_ID: 'legacy-access-key',
    AWS_SECRET_ACCESS_KEY: 'legacy-secret-key',
  });

  assert.equal(config.accessKeyId, 'canonical-access-key');
  assert.equal(config.secretAccessKey, 'canonical-secret-key');
  assert.equal(config.endpoint, `https://${validAccount}.r2.cloudflarestorage.com`);
  assert.equal(config.bucket, 'stream-assets');
});

test('accepts standard AWS credential aliases when Cloudflare names are absent', () => {
  const config = getR2Configuration({
    CLOUDFLARE_R2_ACCOUNT_ID: validAccount,
    AWS_ACCESS_KEY_ID: 'legacy-access-key',
    AWS_SECRET_ACCESS_KEY: 'legacy-secret-key',
    CLOUDFLARE_R2_BUCKET: 'custom-bucket',
    CLOUDFLARE_R2_ENDPOINT: `https://${validAccount}.r2.cloudflarestorage.com///`,
  });

  assert.equal(config.accessKeyId, 'legacy-access-key');
  assert.equal(config.secretAccessKey, 'legacy-secret-key');
  assert.equal(config.bucket, 'custom-bucket');
  assert.equal(config.endpoint, `https://${validAccount}.r2.cloudflarestorage.com`);
});

test('fails closed when credentials are missing without including secret values', () => {
  assert.throws(
    () => getR2Configuration({ CLOUDFLARE_R2_ACCOUNT_ID: validAccount }),
    (error) => {
      assert.equal(error.code, 'R2_CONFIG_MISSING');
      assert.match(error.message, /accessKeyId, secretAccessKey/);
      assert.doesNotMatch(error.message, /TEST_ONLY_NOT_A_REAL_SECRET|legacy-secret-key/);
      return true;
    },
  );
});

test('AWS SDK v3 generates an HTTPS signed PUT for the configured R2 endpoint', async () => {
  const config = getR2Configuration({
    ...validCanonicalEnv,
    CLOUDFLARE_R2_BUCKET_NAME: 'stream-assets',
  });
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: 'TEST_ONLY_ACCESS_KEY',
      secretAccessKey: 'TEST_ONLY_NOT_A_REAL_SECRET',
    },
  });

  const signedUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: config.bucket, Key: 'media/test-video.mp4', ContentType: 'video/mp4' }),
    { expiresIn: 900, signableHeaders: new Set(['content-type']) },
  );
  const parsedUrl = new URL(signedUrl);

  assert.equal(parsedUrl.protocol, 'https:');
  assert.equal(parsedUrl.hostname, `${validAccount}.r2.cloudflarestorage.com`);
  assert.match(parsedUrl.pathname, /\/stream-assets\/media\/test-video\.mp4$/);
  assert.ok(parsedUrl.searchParams.has('X-Amz-Signature'));
  assert.match(parsedUrl.searchParams.get('X-Amz-SignedHeaders') || '', /content-type/);
});