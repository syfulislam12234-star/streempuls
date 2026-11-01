import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractFfmpegErrorLines,
  sanitizeChildProcessError,
  sanitizeFfmpegDiagnostic,
} from '../streamDiagnostics.js';

test('child-process errors never expose raw spawn arguments, stream keys, or signed query parameters', () => {
  const streamKey = 'youtube-live-secret-key';
  const signedUrl = 'https://storage.example.test/media/video.mp4?X-Amz-Signature=private-signature&X-Amz-Credential=secret-credential';
  const error = Object.assign(new Error(`spawn ffmpeg failed for ${streamKey}: ${signedUrl}`), {
    code: 'ENOENT',
    syscall: 'spawn',
    spawnargs: ['-i', signedUrl, 'rtmp://a.example/live2/' + streamKey],
  });

  const safe = sanitizeChildProcessError(error, { secrets: [streamKey] });
  assert.match(safe, /ENOENT/);
  assert.match(safe, /storage\.example\.test\/media\/video\.mp4/);
  assert.doesNotMatch(safe, /youtube-live-secret-key|private-signature|secret-credential|spawnargs/);
});

test('FFmpeg diagnostics retain useful errors while redacting RTMP keys and signed URL queries', () => {
  const key = 'rtmp-key-never-log';
  const signedUrl = 'https://r2.example.test/media/clip.mp4?X-Amz-Signature=never-log-this';
  const lines = extractFfmpegErrorLines(
    `Opening '${signedUrl}' failed: HTTP error 403\r\nConnection to rtmp://ingest.example/live2/${key} refused\r\nframe=10 fps=30`,
    { secrets: [key] },
  );

  assert.equal(lines.length, 2);
  assert.match(lines[0], /HTTP error 403/);
  assert.match(lines[1], /Connection.*refused/);
  assert.doesNotMatch(lines.join(' '), /never-log|rtmp-key-never-log|X-Amz-Signature/);
});

test('generic diagnostic sanitization strips signed query parameters and truncates output', () => {
  const safe = sanitizeFfmpegDiagnostic(
    'Error reading https://r2.example.test/a.mp4?token=very-secret&X-Amz-Signature=sig',
    { maxLength: 100 },
  );
  assert.match(safe, /Error reading/);
  assert.match(safe, /r2\.example\.test\/a\.mp4/);
  assert.doesNotMatch(safe, /very-secret|sig/);
  assert.ok(safe.length <= 100);
});
