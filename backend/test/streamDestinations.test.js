import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRtmpDestination,
  buildStreamDestinationPlan,
  buildStreamDestinations,
  selectStreamDestinationsForAttempt,
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

test('builds YouTube backup URL with its query after the stream key and excludes it from tee outputs', () => {
  const plan = buildStreamDestinationPlan({
    rtmpServerUrl: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'youtube-key',
    subscriptionTier: 'pro',
    destinations: [
      { rtmpServerUrl: 'rtmp://b.rtmp.youtube.com/live2?backup=1', streamKey: 'youtube-key', isEnabled: true },
      { rtmpServerUrl: 'rtmps://backup.example.net/app', streamKey: 'secondary-key', isEnabled: true },
    ],
  });

  assert.equal(plan.primary, 'rtmp://a.rtmp.youtube.com/live2/youtube-key');
  assert.equal(plan.backup, 'rtmp://b.rtmp.youtube.com/live2/youtube-key?backup=1');
  assert.deepEqual(plan.destinations, [
    'rtmp://a.rtmp.youtube.com/live2/youtube-key',
    'rtmps://backup.example.net/app/secondary-key',
  ]);
  assert.deepEqual(selectStreamDestinationsForAttempt(plan), [
    'rtmp://a.rtmp.youtube.com/live2/youtube-key',
    'rtmps://backup.example.net/app/secondary-key',
  ]);
  assert.deepEqual(selectStreamDestinationsForAttempt(plan, { useYoutubeBackup: true }), [
    'rtmp://b.rtmp.youtube.com/live2/youtube-key?backup=1',
    'rtmps://backup.example.net/app/secondary-key',
  ]);
  assert.equal(validateStreamConfiguration({
    rtmpServerUrl: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'youtube-key',
    destinations: [{ rtmpServerUrl: 'rtmp://b.rtmp.youtube.com/live2?backup=1', streamKey: 'youtube-key', isEnabled: true }],
  }), true);
});

test('rejects near-match YouTube backup URLs and mismatched backup keys', () => {
  const base = { rtmpServerUrl: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'youtube-key' };
  for (const server of [
    'rtmp://b.rtmp.youtube.com/live2?backup=1&extra=1',
    'rtmp://b.rtmp.youtube.com/other?backup=1',
    'rtmp://backup.youtube.com/live2?backup=1',
    'rtmps://b.rtmp.youtube.com/live2?backup=1',
  ]) {
    assert.throws(() => buildStreamDestinationPlan({
      ...base,
      destinations: [{ rtmpServerUrl: server, streamKey: 'youtube-key', isEnabled: true }],
    }), /exact YouTube backup server URL/i);
  }
  assert.throws(() => buildStreamDestinationPlan({
    ...base,
    destinations: [{ rtmpServerUrl: 'rtmp://b.rtmp.youtube.com/live2?backup=1', streamKey: 'other-key', isEnabled: true }],
  }), /primary stream key/i);
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
