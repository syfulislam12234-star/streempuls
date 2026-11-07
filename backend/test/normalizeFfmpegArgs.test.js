import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNormalizeFfmpegArgs, getStreamCopyOutputDetails } from '../normalizeFfmpegArgs.js';

test('normalization FFmpeg command remuxes video and audio without encoding', () => {
  const args = buildNormalizeFfmpegArgs('/tmp/source.mp4', '/tmp/output.mp4');

  assert.deepEqual(args, [
    '-y',
    '-i', '/tmp/source.mp4',
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-sn',
    '-dn',
    '-c', 'copy',
    '-movflags', '+faststart',
    '-f', 'mp4',
    '/tmp/output.mp4',
  ]);
  assert.equal(args.includes('libx264'), false);
  assert.equal(args.includes('aac'), false);
  assert.equal(args.includes('-vf'), false);
});

test('stdout MP4 remux uses fragmented flags and explicit muxer', () => {
  const args = buildNormalizeFfmpegArgs('https://r2.example/signed-source', 'pipe:1', { format: 'mp4' });
  assert.deepEqual(args.slice(-5, -1), [
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
  ]);
  assert.equal(args.at(-1), 'pipe:1');
});

test('MKV inputs remain in Matroska and MP4/MOV inputs use MP4', () => {
  assert.deepEqual(getStreamCopyOutputDetails('media/source.mkv'), {
    extension: '.mkv',
    contentType: 'video/x-matroska',
    format: 'matroska',
  });
  assert.deepEqual(getStreamCopyOutputDetails('https://storage.example/media/source.mov?token=redacted'), {
    extension: '.mp4',
    contentType: 'video/mp4',
    format: 'mp4',
  });
  assert.deepEqual(getStreamCopyOutputDetails('media/source.mp4'), {
    extension: '.mp4',
    contentType: 'video/mp4',
    format: 'mp4',
  });
});
