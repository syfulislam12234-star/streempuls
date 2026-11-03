import assert from 'node:assert/strict';
import test from 'node:test';
import { countActiveStreams, reconcileLocalStreamState } from '../streamQuota.js';

test('counts only fresh active streams for the owning user', () => {
  const now = Date.now();
  const streams = [
    { id: 'fresh', user_id: 'owner', status: 'live', last_heartbeat: new Date(now - 1_000).toISOString() },
    { id: 'stale', user_id: 'owner', status: 'live', last_heartbeat: new Date(now - 31_000).toISOString() },
    { id: 'idle', user_id: 'owner', status: 'idle', last_heartbeat: null },
    { id: 'other', user_id: 'other', status: 'live', last_heartbeat: new Date(now - 1_000).toISOString() },
  ];

  assert.equal(countActiveStreams(streams, 'owner', now), 1);
});

test('reclaims stale and missing-heartbeat records but preserves fresh ones', () => {
  const now = Date.now();
  const streams = [
    { id: 'stale', user_id: 'owner', status: 'starting', ffmpeg_pid: 123, worker_node_id: 'old', last_heartbeat: new Date(now - 31_000).toISOString() },
    { id: 'missing', user_id: 'owner', status: 'queued', ffmpeg_pid: 456, worker_node_id: 'old2', last_heartbeat: null },
    { id: 'fresh', user_id: 'owner', status: 'live', ffmpeg_pid: 789, worker_node_id: 'current', last_heartbeat: new Date(now - 1_000).toISOString() },
  ];

  assert.equal(reconcileLocalStreamState(streams, { userId: 'owner', now }), 2);
  assert.equal(streams[0].status, 'idle');
  assert.equal(streams[0].ffmpeg_pid, null);
  assert.equal(streams[0].worker_node_id, null);
  assert.equal(streams[1].status, 'idle');
  assert.equal(streams[2].status, 'live');
  assert.equal(streams[2].worker_node_id, 'current');
});
