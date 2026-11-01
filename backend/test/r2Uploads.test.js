import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
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

async function postJson(baseUrl, route, body, token) {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function registerUser(baseUrl, name) {
  const response = await postJson(baseUrl, '/api/auth/register', {
    email: `${name}@example.test`,
    password: 'a-test-password-only',
    full_name: name,
  });
  assert.equal(response.status, 201);
  return (await response.json()).token;
}

test('direct R2 upload, confirmation, private preview, and per-user asset isolation', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streempuls-r2-assets-'));
  const mediaObjects = new Map();
  const mockR2 = createServer(async (req, res) => {
    const pathParts = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean);
    const key = pathParts.slice(1).join('/');
    if (!key.startsWith('media/')) {
      res.writeHead(404).end();
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
  const ownerToken = await registerUser(baseUrl, 'owner');
  const otherToken = await registerUser(baseUrl, 'other');

  const forgedUserHeader = await fetch(`${baseUrl}/api/uploads`, { headers: { 'X-User-Id': 'some-user' } });
  assert.equal(forgedUserHeader.status, 401, 'client-supplied user IDs must not authenticate asset access');
  const unauthenticatedPresign = await postJson(baseUrl, '/api/storage/presigned-upload', {
    fileName: 'forged-owner.mp4',
    contentType: 'video/mp4',
    preferredProvider: 'r2',
  });
  assert.equal(unauthenticatedPresign.status, 401, 'presigning must require a verified bearer token');

  const presignResponse = await postJson(baseUrl, '/api/storage/presigned-upload', {
    fileName: 'owner-video.mp4',
    contentType: 'video/mp4',
    fileSizeMb: 0.1,
    preferredProvider: 'r2',
  }, ownerToken);
  assert.equal(presignResponse.status, 200);
  const presign = await presignResponse.json();
  assert.equal(presign.provider, 'r2');
  assert.match(presign.key, /^media\//);

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
});
