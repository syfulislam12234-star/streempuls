import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRtmpDestination,
  buildStreamDestinations,
  validateStreamConfiguration,
} from '../streamDestinations.js';

test('builds the primary RTMP destination once from separate server and key values', () => {
  assert.equal(
    buildRtmpDestination('rtmp://a.rtmp.youtube.com/live2/', 'test-key-123'),
    'rtmp://a.rtmp.youtube.com/live2/test-key-123',
  );
});

test('rejects a complete RTMP URL in the stream-key field without echoing it', () => {
  const completeUrl = 'rtmp://a.rtmp.youtube.com/live2/do-not-log-this-key';
  assert.throws(
    () => buildRtmpDestination('rtmp://a.rtmp.youtube.com/live2', completeUrl),
    (error) => {
      assert.match(error.message, /stream key only/i);
      assert.doesNotMatch(error.message, /do-not-log-this-key/);
      return true;
    },
  );
});

test('keeps primary and enabled secondary RTMP outputs separate', () => {
  const outputs = buildStreamDestinations({
    rtmpServerUrl: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'youtube-key',
    subscriptionTier: 'pro',
    destinations: [{
      label: 'Backup',
      rtmpServerUrl: 'rtmps://backup.example.net/app/',
      streamKey: 'backup-key',
      isEnabled: true,
    }],
  });

  assert.deepEqual(outputs, [
    'rtmp://a.rtmp.youtube.com/live2/youtube-key',
    'rtmps://backup.example.net/app/backup-key',
  ]);
  assert.ok(outputs.every((url) => !url.includes('rtmp://a.rtmp.youtube.com/live2/rtmps://')));
});

test('validates enabled secondary keys and rejects incomplete or URL-valued keys', () => {
  assert.throws(() => validateStreamConfiguration({
    rtmpServerUrl: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'youtube-key',
    destinations: [{ rtmpServerUrl: 'rtmp://backup.example.net/app', streamKey: 'rtmp://backup.example.net/app/key', isEnabled: true }],
  }), /stream key only/i);

  assert.throws(() => buildStreamDestinations({
    rtmpServerUrl: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'youtube-key',
    destinations: [{ rtmpServerUrl: 'rtmp://backup.example.net/app', streamKey: '', isEnabled: true }],
  }), /server URL and a stream key/i);
});

test('ignores disabled backup entries and respects existing tier output caps', () => {
  const outputs = buildStreamDestinations({
    rtmpServerUrl: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'primary-key',
    subscriptionTier: 'pro',
    destinations: [
      { rtmpServerUrl: 'rtmp://ignored.example/app', streamKey: 'ignored-key', isEnabled: false },
      { rtmpServerUrl: 'rtmp://backup.example/app', streamKey: 'backup-key', isEnabled: true },
      { rtmpServerUrl: 'rtmp://extra.example/app', streamKey: 'extra-key', isEnabled: true },
    ],
  });

  assert.deepEqual(outputs, [
    'rtmp://a.rtmp.youtube.com/live2/primary-key',
    'rtmp://backup.example/app/backup-key',
  ]);
});
