import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStreamDestinations, validateStreamConfiguration } from '../streamDestinations.js';
import { claimStreamOwnership, updateStreamWhenOwned } from '../streamOwnership.js';

class FakeQuery {
  constructor(store, action, payload) {
    this.store = store;
    this.action = action;
    this.payload = payload;
    this.filters = [];
  }
  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  is(column, value) { this.filters.push([column, value]); return this; }
  async maybeSingle() {
    if (this.action === 'select') return { data: this.store.row ? { ...this.store.row } : null, error: null };
    if (!this.store.row || !this.filters.every(([column, value]) => this.store.row[column] === value)) {
      return { data: null, error: null };
    }
    this.store.row = { ...this.store.row, ...this.payload };
    return { data: { id: this.store.row.id }, error: null };
  }
}

class FakeDatabase {
  constructor(row) { this.row = row; }
  from() {
    return {
      select: () => new FakeQuery(this, 'select'),
      update: (payload) => new FakeQuery(this, 'update', payload),
    };
  }
}

test('direct runtime claims are atomic and a failed start releases only its own claim', async () => {
  const database = new FakeDatabase({ id: 'direct-race', status: 'idle', worker_node_id: null, last_heartbeat: null });
  const now = Date.now();
  const [first, second] = await Promise.all([
    claimStreamOwnership(database, {
      streamId: 'direct-race', token: 'direct-owner-a', now,
      updates: { status: 'starting', last_heartbeat: new Date(now).toISOString() },
    }),
    claimStreamOwnership(database, {
      streamId: 'direct-race', token: 'direct-owner-b', now,
      updates: { status: 'starting', last_heartbeat: new Date(now).toISOString() },
    }),
  ]);
  assert.deepEqual([first, second].sort(), [false, true]);
  const owner = database.row.worker_node_id;
  assert.equal(await updateStreamWhenOwned(database, {
    streamId: 'direct-race', token: owner,
    updates: { status: 'ERROR', ffmpeg_pid: null, last_error: 'FFmpeg could not start safely.' },
    release: true,
  }), true);
  assert.equal(database.row.worker_node_id, null);
  assert.equal(database.row.status, 'ERROR');
});

test('direct runtime validates separate RTMP fields and preserves valid destination compatibility', () => {
  assert.throws(() => validateStreamConfiguration({
    rtmpServerUrl: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'rtmp://a.rtmp.youtube.com/live2/not-a-key',
  }), /stream key only/i);

  assert.deepEqual(buildStreamDestinations({
    rtmpServerUrl: 'rtmps://ingest.example.test/live/',
    streamKey: 'existing-key',
    subscriptionTier: 'pro',
    destinations: [{ isEnabled: true, rtmpServerUrl: 'rtmp://backup.example.test/app', streamKey: 'backup-key' }],
  }), [
    'rtmps://ingest.example.test/live/existing-key',
    'rtmp://backup.example.test/app/backup-key',
  ]);
});
