import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiEntry = path.join(projectRoot, 'backend', 'server.js');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function getFreePort() {
  const server = createNetServer();
  const port = await listen(server);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForApi(api, baseUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (api.exitCode !== null) assert.fail(`API exited before becoming ready with code ${api.exitCode}`);
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('API did not become ready');
}

async function postJson(baseUrl, route, body, token, origin) {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function registerUser(baseUrl, name) {
  const credentials = {
    email: `${name}@example.test`,
    password: 'a-test-password-only',
    full_name: name,
  };
  const response = await postJson(baseUrl, '/api/auth/register', {
    ...credentials,
  });
  assert.equal(response.status, 201);
  const data = await response.json();
  return { token: data.token, userId: data.user.id, credentials };
}

test('direct R2 upload, confirmation, private preview, and per-user asset isolation', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streempuls-r2-assets-'));
  const mediaObjects = new Map();
  const multipartUploads = new Map();
  const mockR2 = createServer(async (req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    const pathParts = requestUrl.pathname.split('/').filter(Boolean);
    const key = pathParts.slice(1).join('/');

    if (!key.startsWith('media/')) {
      res.writeHead(404).end();
      return;
    }

    if (req.method === 'POST' && requestUrl.searchParams.has('uploads')) {
      const uploadId = randomUUID();
      multipartUploads.set(uploadId, {
        key,
        contentType: req.headers['content-type'] || 'application/octet-stream',
        parts: new Map(),
      });
      res.writeHead(200, { 'Content-Type': 'application/xml' }).end(
        `<CreateMultipartUploadResult><Bucket>stream-assets</Bucket><Key>${key}</Key><UploadId>${uploadId}</UploadId></CreateMultipartUploadResult>`,
      );
      return;
    }

    const uploadId = requestUrl.searchParams.get('uploadId');
    if (uploadId && req.method === 'PUT') {
      const upload = multipartUploads.get(uploadId);
      if (!upload || upload.key !== key) {
        res.writeHead(404, { 'Content-Type': 'application/xml' }).end('<Error><Code>NoSuchUpload</Code></Error>');
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const partNumber = Number(requestUrl.searchParams.get('partNumber'));
      const etag = `"part-${partNumber}"`;
      upload.parts.set(partNumber, { body: Buffer.concat(chunks), etag });
      res.writeHead(200, { ETag: etag }).end();
      return;
    }

    if (uploadId && req.method === 'POST') {
      const upload = multipartUploads.get(uploadId);
      if (!upload || upload.key !== key) {
        res.writeHead(404, { 'Content-Type': 'application/xml' }).end('<Error><Code>NoSuchUpload</Code></Error>');
        return;
      }
      for await (const _chunk of req) {}
      const orderedParts = [...upload.parts.entries()].sort(([a], [b]) => a - b).map(([, part]) => part);
      mediaObjects.set(key, {
        body: Buffer.concat(orderedParts.map((part) => part.body)),
        contentType: upload.contentType,
      });
      multipartUploads.delete(uploadId);
      res.writeHead(200, { 'Content-Type': 'application/xml' }).end(
        `<CompleteMultipartUploadResult><Location>http://localhost/${key}</Location><Bucket>stream-assets</Bucket><Key>${key}</Key><ETag>"multipart-etag"</ETag></CompleteMultipartUploadResult>`,
      );
      return;
    }

    if (uploadId && req.method === 'DELETE') {
      multipartUploads.delete(uploadId);
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'PUT') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      mediaObjects.set(key, {
        body: Buffer.concat(chunks),
        contentType: req.headers['content-type'] || 'application/octet-stream',
      });
      res.writeHead(200, { ETag: '"test-etag"' }).end();
      return;
    }

    const object = mediaObjects.get(key);
    if (!object) {
      res.writeHead(404, { 'Content-Type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>');
      return;
    }

    const headers = {
      'Content-Type': object.contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': object.body.length,
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers).end();
      return;
    }
    if (req.method === 'GET') {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (match) {
        const start = Number(match[1]);
        const end = match[2] ? Math.min(Number(match[2]), object.body.length - 1) : object.body.length - 1;
        const rangeBody = object.body.subarray(start, end + 1);
        res.writeHead(206, {
          ...headers,
          'Content-Length': rangeBody.length,
          'Content-Range': `bytes ${start}-${end}/${object.body.length}`,
        }).end(rangeBody);
      } else {
        res.writeHead(200, headers).end(object.body);
      }
      return;
    }
    res.writeHead(405).end();
  });

  const r2Port = await listen(mockR2);
  const apiPort = await getFreePort();
  const wsPort = await getFreePort();
  const legacyCatalog = [{ key: 'media/legacy-unowned.mp4', fileName: 'legacy.mp4', url: 'https://private.example/media/legacy-unowned.mp4' }];
  fs.writeFileSync(path.join(tempDir, 'uploaded_assets.json'), JSON.stringify(legacyCatalog));
  const api = spawn(process.execPath, [apiEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(apiPort),
      WS_PORT: String(wsPort),
      DATA_DIR: tempDir,
      NODE_ENV: 'test',
      CORS_ORIGINS: 'http://127.0.0.1',
      R2_CORS_ALLOWED_ORIGINS: 'https://streempuls.mooo.com,https://www.streempuls.mooo.com,http://localhost:5173,http://127.0.0.1:5173',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      CLOUDFLARE_R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      CLOUDFLARE_R2_ENDPOINT: `http://127.0.0.1:${r2Port}`,
      CLOUDFLARE_R2_ACCESS_KEY_ID: 'test-access-key',
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'test-secret-key-not-real',
      CLOUDFLARE_R2_BUCKET_NAME: 'stream-assets',
      CLOUDFLARE_R2_PUBLIC_DOMAIN: '',
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    api.kill();
    await new Promise((resolve) => api.once('exit', resolve));
    await Promise.all([
      new Promise((resolve) => mockR2.close(resolve)),
      new Promise((resolve) => fs.rm(tempDir, { recursive: true, force: true }, resolve)),
    ]);
  });

  const baseUrl = `http://127.0.0.1:${apiPort}`;
  await waitForApi(api, baseUrl);
  const apiPreflight = await fetch(`${baseUrl}/api/storage/presigned-upload`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://streempuls.mooo.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(apiPreflight.status, 204);
  assert.equal(apiPreflight.headers.get('access-control-allow-origin'), 'https://streempuls.mooo.com');
  const { userId: ownerUserId, credentials: ownerCredentials } = await registerUser(baseUrl, 'owner');
  const { credentials: otherCredentials } = await registerUser(baseUrl, 'other');
  const savedUsers = JSON.parse(fs.readFileSync(path.join(tempDir, 'users.json'), 'utf8'));
  const savedOwner = savedUsers.find((user) => user.id === ownerUserId);
  assert.match(savedOwner.password_hash, /^\$2[aby]\$/);
  assert.equal(Object.hasOwn(savedOwner, 'password'), false);
  assert.equal(Object.hasOwn(savedOwner, 'password_salt'), false);
  const invalidLogin = await postJson(baseUrl, '/api/auth/login', {
    email: ownerCredentials.email,
    password: 'incorrect-password',
  });
  assert.equal(invalidLogin.status, 401);
  assert.equal((await invalidLogin.json()).error, 'Invalid email or password.');
  const ownerLogin = await postJson(baseUrl, '/api/auth/login', ownerCredentials);
  const otherLogin = await postJson(baseUrl, '/api/auth/login', otherCredentials);
  assert.equal(ownerLogin.status, 200);
  assert.equal(otherLogin.status, 200);
  const ownerToken = (await ownerLogin.json()).token;
  const otherToken = (await otherLogin.json()).token;

  const connectionTestResponse = await postJson(baseUrl, '/api/streams/test-connection', {
    rtmpServerUrl: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'owner-test-key',
  }, ownerToken);
  assert.equal(connectionTestResponse.status, 200, 'the stored Bearer session must authenticate Test Connection');

  const anonymousSession = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(anonymousSession.status, 401, 'an anonymous request must not be assigned the first user');
  const forgedSession = await fetch(`${baseUrl}/api/auth/me`, { headers: { 'X-User-Id': ownerUserId } });
  assert.equal(forgedSession.status, 401, 'a user ID header must not authenticate a session');
  const authenticatedSession = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(authenticatedSession.status, 200);
  assert.equal((await authenticatedSession.json()).user.id, ownerUserId);

  const forgedUserHeader = await fetch(`${baseUrl}/api/uploads`, { headers: { 'X-User-Id': 'some-user' } });
  assert.equal(forgedUserHeader.status, 401, 'client-supplied user IDs must not authenticate asset access');
  const unauthenticatedPresign = await postJson(baseUrl, '/api/storage/presigned-upload', {
    fileName: 'forged-owner.mp4',
    contentType: 'video/mp4',
    preferredProvider: 'r2',
  });
  assert.equal(unauthenticatedPresign.status, 401, 'presigning must require a verified bearer token');
  assert.equal((await postJson(baseUrl, '/api/storage/confirm-upload', { key: 'media/unowned.mp4' })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/uploads`)).status, 401);
  assert.equal((await postJson(baseUrl, '/api/storage/preview-url', { videoUrl: 'https://example.test/video.mp4' })).status, 401);

  const presignPayload = {
    fileName: 'owner-video.mp4',
    contentType: 'video/mp4',
    fileSizeMb: 0.1,
    preferredProvider: 'r2',
  };
  const deniedPresignResponse = await postJson(baseUrl, '/api/storage/presigned-upload', presignPayload, ownerToken, 'https://unlisted.example');
  assert.equal(deniedPresignResponse.status, 403);
  assert.match((await deniedPresignResponse.json()).error, /R2_CORS_ALLOWED_ORIGINS/);

  const presignResponse = await postJson(baseUrl, '/api/storage/presigned-upload', presignPayload, ownerToken, 'https://streempuls.mooo.com');
  assert.equal(presignResponse.status, 200);
  const presign = await presignResponse.json();
  assert.equal(presign.provider, 'r2');
  assert.match(presign.key, /^media\//);
  assert.deepEqual(presign.headers, { 'Content-Type': 'video/mp4' });
  assert.match(new URL(presign.uploadUrl).searchParams.get('X-Amz-SignedHeaders'), /(^|;)content-type(;|$)/);
  assert.equal(presign.cors.allowedOrigin, 'https://streempuls.mooo.com');

  const videoBytes = Buffer.from('fake-mp4-header: ftyp; owner-scoped upload test');
  const putResponse = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: presign.headers,
    body: videoBytes,
  });
  assert.equal(putResponse.status, 200);

  const confirmResponse = await postJson(baseUrl, '/api/storage/confirm-upload', {
    key: presign.key,
    fileName: 'owner-video.mp4',
    provider: 'r2',
    fileSizeMb: 999,
  }, ownerToken);
  assert.equal(confirmResponse.status, 200);
  const confirmation = await confirmResponse.json();
  assert.equal(confirmation.asset.sizeBytes, videoBytes.length, 'size must come from R2, not the client');
  assert.equal(confirmation.asset.contentType, 'video/mp4');
  assert.equal(confirmation.asset.fileSizeMb, +(videoBytes.length / (1024 * 1024)).toFixed(1));
  assert.equal(confirmation.asset.resolution, 'Not analyzed');
  assert.equal(confirmation.asset.url, presign.publicUrl, 'the durable stream source stays separate from the expiring preview URL');
  assert.equal(new URL(confirmation.asset.url).search, '', 'the durable URL must not contain preview-signature parameters');
  assert.ok(confirmation.asset.previewUrl);
  assert.equal(Object.hasOwn(confirmation.asset, 'ownerUserId'), false);

  const ownerListResponse = await fetch(`${baseUrl}/api/uploads`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(ownerListResponse.status, 200);
  const ownerList = await ownerListResponse.json();
  assert.deepEqual(ownerList.assets.map((asset) => asset.key), [presign.key]);
  assert.equal(ownerList.assets[0].contentType, 'video/mp4');
  assert.ok(ownerList.assets[0].previewUrl);

  const previewResponse = await postJson(baseUrl, '/api/storage/preview-url', { videoUrl: confirmation.asset.url }, ownerToken);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.expiresInSeconds, 600);
  const rangeResponse = await fetch(preview.previewUrl, { headers: { Range: 'bytes=0-7' } });
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers.get('content-range'), `bytes 0-7/${videoBytes.length}`);
  assert.equal(rangeResponse.headers.get('content-type'), 'video/mp4');
  assert.equal((await rangeResponse.arrayBuffer()).byteLength, 8);

  const otherListResponse = await fetch(`${baseUrl}/api/uploads`, { headers: { Authorization: `Bearer ${otherToken}` } });
  assert.equal(otherListResponse.status, 200);
  assert.deepEqual((await otherListResponse.json()).assets, [], 'another user must not see the confirmed asset or legacy unowned object');

  const otherConfirmResponse = await postJson(baseUrl, '/api/storage/confirm-upload', { key: presign.key }, otherToken);
  assert.equal(otherConfirmResponse.status, 404);
  const otherPreviewResponse = await postJson(baseUrl, '/api/storage/preview-url', { videoUrl: confirmation.asset.url }, otherToken);
  assert.equal(otherPreviewResponse.status, 404);

  const unauthenticatedMultipart = await postJson(baseUrl, '/api/storage/multipart/initiate', {
    fileName: 'multipart-video.mp4',
    contentType: 'video/mp4',
    fileSizeBytes: 32,
    partSizeBytes: 5 * 1024 * 1024,
  });
  assert.equal(unauthenticatedMultipart.status, 401);

  const multipartInitResponse = await postJson(baseUrl, '/api/storage/multipart/initiate', {
    fileName: 'multipart-video.mp4',
    contentType: 'video/mp4',
    fileSizeBytes: 32,
    partSizeBytes: 5 * 1024 * 1024,
  }, ownerToken, 'https://streempuls.mooo.com');
  assert.equal(multipartInitResponse.status, 200, await multipartInitResponse.clone().text());
  const multipart = await multipartInitResponse.json();
  assert.equal(multipart.partCount, 1);
  assert.equal(multipart.cors.exposeHeaders.includes('ETag'), true);
  assert.match(multipart.uploadId, /^[0-9a-f-]{36}$/i);

  const otherPartUrlResponse = await postJson(baseUrl, '/api/storage/multipart/presign-part', {
    key: multipart.key,
    uploadId: multipart.uploadId,
    partNumber: 1,
  }, otherToken);
  assert.equal(otherPartUrlResponse.status, 404, 'another user cannot sign an owner upload part');

  const invalidPartUrlResponse = await postJson(baseUrl, '/api/storage/multipart/presign-part', {
    key: multipart.key,
    uploadId: multipart.uploadId,
    partNumber: 2,
  }, ownerToken);
  assert.equal(invalidPartUrlResponse.status, 400, 'part numbers are bounded by the initiated upload');

  const partUrlResponse = await postJson(baseUrl, '/api/storage/multipart/presign-part', {
    key: multipart.key,
    uploadId: multipart.uploadId,
    partNumber: 1,
  }, ownerToken, 'https://streempuls.mooo.com');
  assert.equal(partUrlResponse.status, 200);
  const partUrl = await partUrlResponse.json();
  assert.equal(partUrl.headers['Content-Type'], 'video/mp4');
  const multipartBytes = Buffer.from('multipart R2 upload payload');
  const partResponse = await fetch(partUrl.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    body: multipartBytes,
  });
  assert.equal(partResponse.status, 200);
  const partEtag = partResponse.headers.get('etag');
  assert.ok(partEtag);

  const missingPartsResponse = await postJson(baseUrl, '/api/storage/multipart/complete', {
    key: multipart.key,
    uploadId: multipart.uploadId,
    parts: [],
  }, ownerToken);
  assert.equal(missingPartsResponse.status, 400);

  const otherCompleteResponse = await postJson(baseUrl, '/api/storage/multipart/complete', {
    key: multipart.key,
    uploadId: multipart.uploadId,
    parts: [{ PartNumber: 1, ETag: partEtag }],
  }, otherToken);
  assert.equal(otherCompleteResponse.status, 404);

  const completeResponse = await postJson(baseUrl, '/api/storage/multipart/complete', {
    key: multipart.key,
    uploadId: multipart.uploadId,
    parts: [{ PartNumber: 1, ETag: partEtag }],
  }, ownerToken);
  assert.equal(completeResponse.status, 200);
  const repeatedCompleteResponse = await postJson(baseUrl, '/api/storage/multipart/complete', {
    key: multipart.key,
    uploadId: multipart.uploadId,
    parts: [{ PartNumber: 1, ETag: partEtag }],
  }, ownerToken);
  assert.equal(repeatedCompleteResponse.status, 200, 'completion retries are idempotent after R2 assembly');

  const multipartConfirmResponse = await postJson(baseUrl, '/api/storage/confirm-upload', {
    key: multipart.key,
    fileName: 'multipart-video.mp4',
    provider: 'r2',
  }, ownerToken);
  assert.equal(multipartConfirmResponse.status, 200);
  const multipartConfirmation = await multipartConfirmResponse.json();
  assert.equal(multipartConfirmation.asset.sizeBytes, multipartBytes.length);
  assert.equal(multipartConfirmation.asset.contentType, 'video/mp4');

  const pendingStreamResponse = await postJson(baseUrl, '/api/streams', {
    title: 'Normalization gate test',
    videoUrl: multipartConfirmation.asset.url,
    streamKey: 'normalization-test-key',
    rtmpServerUrl: 'rtmp://a.rtmp.youtube.com/live2',
  }, ownerToken);
  assert.equal(pendingStreamResponse.status, 201);
  const pendingStream = (await pendingStreamResponse.json()).stream;
  const blockedStartResponse = await postJson(baseUrl, `/api/streams/${pendingStream.id}/start`, {}, ownerToken);
  assert.equal(blockedStartResponse.status, 409);
  const blockedStart = await blockedStartResponse.json();
  assert.equal(blockedStart.code, 'VIDEO_NORMALIZATION_PENDING');
  assert.match(blockedStart.error, /cannot go live until completed/i);

  const abortInitResponse = await postJson(baseUrl, '/api/storage/multipart/initiate', {
    fileName: 'cancelled-video.mp4',
    contentType: 'video/mp4',
    fileSizeBytes: 32,
    partSizeBytes: 5 * 1024 * 1024,
  }, ownerToken);
  assert.equal(abortInitResponse.status, 200);
  const abortUpload = await abortInitResponse.json();
  const otherAbortResponse = await postJson(baseUrl, '/api/storage/multipart/abort', {
    key: abortUpload.key,
    uploadId: abortUpload.uploadId,
  }, otherToken);
  assert.equal(otherAbortResponse.status, 404);
  const abortResponse = await postJson(baseUrl, '/api/storage/multipart/abort', {
    key: abortUpload.key,
    uploadId: abortUpload.uploadId,
  }, ownerToken);
  assert.equal(abortResponse.status, 200);
  assert.equal(multipartUploads.has(abortUpload.uploadId), false);
});
