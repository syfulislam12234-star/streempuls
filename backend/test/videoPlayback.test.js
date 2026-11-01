import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiEntry = path.join(projectRoot, 'backend', 'server.js');

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('serves the bundled sample video with correct range and media headers', async (t) => {
  const [apiPort, wsPort] = await Promise.all([getFreePort(), getFreePort()]);
  const api = spawn(process.execPath, [apiEntry], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(apiPort), WS_PORT: String(wsPort) },
    stdio: 'ignore',
  });
  t.after(() => api.kill());

  const baseUrl = `http://127.0.0.1:${apiPort}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (api.exitCode !== null) assert.fail(`API exited before becoming ready with code ${api.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'API should become ready for the static media request');

  const head = await fetch(`${baseUrl}/uploads/sample_lofi_broadcast_1080p60.mp4`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type') || '', /^video\/mp4/i);
  const contentLength = Number(head.headers.get('content-length'));
  assert.ok(contentLength > 0);

  const range = await fetch(`${baseUrl}/uploads/sample_lofi_broadcast_1080p60.mp4`, {
    headers: { Range: 'bytes=0-31' },
  });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 0-31/${contentLength}`);
  assert.equal(Number(range.headers.get('content-length')), 32);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()).subarray(4, 8), Buffer.from('ftyp'));
});