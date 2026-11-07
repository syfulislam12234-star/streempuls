import assert from 'node:assert/strict';
import test from 'node:test';
import { directCopyIneligibility, directStreamCopyIneligibility, parseFfmpegProgressRecord } from '../ffmpegProgress.js';

test('parses structured FFmpeg progress without guessing missing metrics', () => {
  assert.deepEqual(parseFfmpegProgressRecord([
    'frame=180',
    'fps=30.0',
    'bitrate=5000.0kbits/s',
    'out_time=00:00:06.000000',
    'drop_frames=2',
    'speed=1.00x',
    'progress=continue',
  ].join('\n')), {
    frame: 180,
    fps: 30,
    bitrateKbps: 5000,
    droppedFrames: 2,
    outputTimeSeconds: 6,
    speed: 1,
    progress: 'continue',
  });
});

test('represents unavailable FFmpeg progress fields as null', () => {
  const progress = parseFfmpegProgressRecord('bitrate=N/A\nfps=N/A\nout_time=N/A\nspeed=N/A\nprogress=continue');
  assert.equal(progress.bitrateKbps, null);
  assert.equal(progress.fps, null);
  assert.equal(progress.outputTimeSeconds, null);
  assert.equal(progress.speed, null);
});

test('allows Direct Copy only for verified stream metadata and keyframe cadence', () => {
  const eligible = {
    codecName: 'h264',
    width: 1920,
    height: 1080,
    rFrameRate: '30/1',
    bitrate: 5_000_000,
    keyframeIntervalSeconds: 2,
  };
  assert.equal(directCopyIneligibility(eligible), null);
  assert.equal(directCopyIneligibility({ ...eligible, bitrate: null }), 'bitrate-over-8000000-or-unknown');
  assert.equal(directCopyIneligibility({ ...eligible, keyframeIntervalSeconds: 3 }), 'keyframe-interval-over-2.5s-or-unknown');
  assert.equal(directCopyIneligibility({ ...eligible, width: 1921 }), 'resolution-unsupported');
});

test('only bypasses remux for H.264/AAC sources with supported stream-copy metadata', () => {
  const eligible = {
    codecName: 'h264',
    width: 1920,
    height: 1080,
    rFrameRate: '30/1',
    bitrate: 5_000_000,
    keyframeIntervalSeconds: 2,
    audioCodec: 'aac',
    audioSampleRate: 48000,
    audioChannels: 2,
  };
  assert.equal(directStreamCopyIneligibility(eligible), null);
  assert.equal(directStreamCopyIneligibility({ ...eligible, audioCodec: 'mp3' }), 'audio-codec-not-aac');
  assert.equal(directStreamCopyIneligibility({ ...eligible, audioSampleRate: 32000 }), 'audio-sample-rate-unsupported');
  assert.equal(directStreamCopyIneligibility({ ...eligible, codecName: 'hevc' }), 'codec-not-h264');
});
