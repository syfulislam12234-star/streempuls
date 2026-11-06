import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { downloadVideoToLocalFile, resolveLocalUpload } from '../localVideoSource.js';

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

test('downloads a remote video to a local file before FFmpeg input', async (t) => {
  const body = Buffer.from('cached video payload');
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-length': body.length });
    response.end(body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'streempuls-video-cache-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'source.input');
  const address = server.address();
  const downloadedPath = await downloadVideoToLocalFile(
    `http://127.0.0.1:${address.port}/masked-source`,
    destination,
    { expectedBytes: body.length },
  );

  assert.equal(downloadedPath, destination);
  assert.deepEqual(fs.readFileSync(destination), body);
});

test('removes partial local cache files when a remote download fails', async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-length': 10 });
    response.end('too-large');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'streempuls-video-cache-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'source.input');
  const address = server.address();

  await assert.rejects(
    downloadVideoToLocalFile(`http://127.0.0.1:${address.port}/secret-query-omitted`, destination, { maxBytes: 4 }),
    (error) => !error.message.includes('secret-query-omitted'),
  );
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('rejects HTTP errors without leaving a cache file', async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(503, { 'content-length': 4 });
    response.end('fail');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'streempuls-video-http-error-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const address = server.address();
  await assert.rejects(
    downloadVideoToLocalFile(`http://127.0.0.1:${address.port}/unavailable`, path.join(directory, 'source.input')),
    /unsuccessful response/i,
  );
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('rejects a completed response whose body is shorter than storage metadata', async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200);
    response.end('partial');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'streempulse-video-incomplete-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const address = server.address();
  await assert.rejects(
    downloadVideoToLocalFile(`http://127.0.0.1:${address.port}/incomplete`, path.join(directory, 'source.input'), {
      expectedBytes: 10,
    }),
    /empty or incomplete/i,
  );
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('aborts timed-out downloads and removes partial files', async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-length': 20 });
    response.write('partial');
    setTimeout(() => response.end('response-is-late'), 200);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'streempulse-video-timeout-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const address = server.address();
  await assert.rejects(
    downloadVideoToLocalFile(`http://127.0.0.1:${address.port}/slow`, path.join(directory, 'source.input'), {
      timeoutMs: 40,
      expectedBytes: 20,
    }),
    /timed out/i,
  );
  assert.deepEqual(fs.readdirSync(directory), []);
});