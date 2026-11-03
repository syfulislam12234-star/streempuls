import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueStreamStart } from '../streamStart.js';
import { reconcileUserStreamsForStart } from '../streamOwnership.js';

class FakeRedis {
  constructor() {
    this.entries = new Map();
    this.now = 1_000;
  }

  expireEntries() {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= this.now) this.entries.delete(key);
    }
  }

  async set(key, value, mode, ttlMs, nx) {
    this.expireEntries();
    if (mode !== 'PX' || nx !== 'NX') throw new Error('Unexpected SET arguments');
    if (this.entries.has(key)) return null;
    this.entries.set(key, { value, expiresAt: this.now + Number(ttlMs) });
    return 'OK';
  }

  async eval(script, keyCount, key, token, ttlMs) {
    this.expireEntries();
    if (keyCount !== 1) throw new Error('Unexpected EVAL key count');
    const entry = this.entries.get(key);
    if (!entry || entry.value !== token) return 0;
    if (script.includes('PEXPIRE')) {
      entry.expiresAt = this.now + Number(ttlMs);
      return 1;
    }
    if (script.includes('DEL')) {
      this.entries.delete(key);
      return 1;
    }
    throw new Error('Unexpected Lua command');
  }
}

class FakeJob {
  constructor(id, data, state = 'waiting') {
    this.id = id;
    this.name = 'start-stream';
    this.data = data;
    this.state = state;
    this.removed = false;
  }
  async getState() { return this.state; }
  async remove() { this.removed = true; }
}

class FakeQueue {
  constructor(jobs = []) {
    this.jobs = new Map(jobs.map((job) => [job.id, job]));
    this.addCount = 0;
  }
  async getJob(id) { return this.jobs.get(id) || null; }
  async getJobs(states) { return [...this.jobs.values()].filter((job) => states.includes(job.state) && !job.removed); }
  async add(name, data, options) {
    this.addCount++;
    const job = new FakeJob(options.jobId, data, 'waiting');
    job.name = name;
    this.jobs.set(job.id, job);
    return job;
  }
}

class Query {
  constructor(db, action, payload) {
    this.db = db;
    this.action = action;
    this.payload = payload;
    this.filters = [];
  }
  select() { return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  neq(column, value) { this.filters.push((row) => row[column] !== value); return this; }
  is(column, value) { this.filters.push((row) => row[column] === value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  async then(resolve, reject) {
    try {
      const rows = this.db.rows.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.action === 'select') resolve({ data: rows.map((row) => ({ ...row })), error: null });
      else {
        for (const row of rows) Object.assign(row, this.payload);
        resolve({ data: rows.map((row) => ({ id: row.id })), error: null });
      }
    } catch (error) { reject(error); }
  }
  async maybeSingle() {
    const rows = this.db.rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.action === 'select') return { data: rows[0] ? { ...rows[0] } : null, error: null };
    if (rows[0]) Object.assign(rows[0], this.payload);
    return { data: rows[0] ? { id: rows[0].id } : null, error: null };
  }
}

class FakeDatabase {
  constructor(rows) { this.rows = rows; this.deletedIds = []; }
  from(table) {
    assert.equal(table, 'streams');
    return {
      select: () => new Query(this, 'select'),
      update: (payload) => new Query(this, 'update', payload),
      delete: () => new Query(this, 'delete'),
    };
  }
}

function startRequestOptions({
  redis, queue, stream, database, userId, planMaxStreams,
  markStarting = async (value) => { value.status = 'starting'; },
  ensureStreamRecord = async () => {},
}) {
  return {
    redis,
    queue,
    database,
    userId,
    planMaxStreams,
    streamId: stream.id,
    getStream: async () => stream,
    getSubscriptionTier: async () => 'free',
    markStarting,
    authorizeStream: async () => true,
    ensureStreamRecord,
  };
}

test('clears terminal (failed/stopped) records for the user before starting', async () => {
  const now = Date.now();
  const database = new FakeDatabase([
    { id: 'stale-failed', user_id: 'owner', status: 'failed', last_heartbeat: new Date(now - 60_000).toISOString() },
    { id: 'stale-stopped', user_id: 'owner', status: 'stopped', last_heartbeat: new Date(now - 60_000).toISOString() },
    { id: 'target', user_id: 'owner', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', last_heartbeat: null },
  ]);

  const redis = new FakeRedis();
  const queue = new FakeQueue();
  const stream = { id: 'target', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', user_id: 'owner' };

  const result = await enqueueStreamStart(startRequestOptions({
    redis, queue, stream, database, userId: 'owner', planMaxStreams: 1,
  }));

  assert.equal(result.kind, 'started');
  assert.equal(queue.addCount, 1);
});

test('reclaims stale active records for other streams of the same user', async () => {
  const now = Date.now();
  const database = new FakeDatabase([
    { id: 'other-live', user_id: 'owner', status: 'live', worker_node_id: 'old-token', last_heartbeat: new Date(now - 60_000).toISOString() },
    { id: 'target', user_id: 'owner', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', last_heartbeat: null },
  ]);

  const redis = new FakeRedis();
  const queue = new FakeQueue();
  const stream = { id: 'target', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', user_id: 'owner' };

  const result = await enqueueStreamStart(startRequestOptions({
    redis, queue, stream, database, userId: 'owner', planMaxStreams: 1,
  }));

  assert.equal(result.kind, 'started');
  const other = database.rows.find((r) => r.id === 'other-live');
  assert.equal(other.status, 'idle');
  assert.equal(other.worker_node_id, null);
  assert.equal(queue.addCount, 1);
});

test('preserves fresh active streams of other users', async () => {
  const now = Date.now();
  const database = new FakeDatabase([
    { id: 'other-user-live', user_id: 'other', status: 'live', worker_node_id: 'other-token', last_heartbeat: new Date(now - 1_000).toISOString() },
    { id: 'target', user_id: 'owner', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', last_heartbeat: null },
  ]);

  const redis = new FakeRedis();
  const queue = new FakeQueue();
  const stream = { id: 'target', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', user_id: 'owner' };

  const result = await enqueueStreamStart(startRequestOptions({
    redis, queue, stream, database, userId: 'owner', planMaxStreams: 1,
  }));

  assert.equal(result.kind, 'started');
  const other = database.rows.find((r) => r.id === 'other-user-live');
  assert.equal(other.status, 'live');
  assert.equal(other.worker_node_id, 'other-token');
});

test('enforces Free plan max 1 active stream - rejects when limit reached', async () => {
  const now = Date.now();
  const database = new FakeDatabase([
    { id: 'existing-active', user_id: 'owner', status: 'live', worker_node_id: 'token-a', last_heartbeat: new Date(now - 1_000).toISOString() },
    { id: 'target', user_id: 'owner', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', last_heartbeat: null },
  ]);

  const redis = new FakeRedis();
  const queue = new FakeQueue();
  const stream = { id: 'target', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', user_id: 'owner' };

  const result = await enqueueStreamStart(startRequestOptions({
    redis, queue, stream, database, userId: 'owner', planMaxStreams: 1,
  }));

  assert.equal(result.kind, 'plan-limit-exceeded');
  assert.equal(result.activeCount, 1);
  assert.equal(result.planMaxStreams, 1);
  assert.equal(queue.addCount, 0);
});

test('allows start when under plan limit (Free plan, no other active streams)', async () => {
  const now = Date.now();
  const database = new FakeDatabase([
    { id: 'idle-other', user_id: 'owner', status: 'idle', last_heartbeat: null },
    { id: 'target', user_id: 'owner', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', last_heartbeat: null },
  ]);

  const redis = new FakeRedis();
  const queue = new FakeQueue();
  const stream = { id: 'target', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', user_id: 'owner' };

  const result = await enqueueStreamStart(startRequestOptions({
    redis, queue, stream, database, userId: 'owner', planMaxStreams: 1,
  }));

  assert.equal(result.kind, 'started');
  assert.equal(queue.addCount, 1);
});

test('allows start when at limit but the active stream is the one being restarted', async () => {
  const now = Date.now();
  const database = new FakeDatabase([
    { id: 'target', user_id: 'owner', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', last_heartbeat: null },
  ]);

  const redis = new FakeRedis();
  const queue = new FakeQueue();
  const stream = { id: 'target', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', user_id: 'owner' };

  const result = await enqueueStreamStart(startRequestOptions({
    redis, queue, stream, database, userId: 'owner', planMaxStreams: 1,
  }));

  assert.equal(result.kind, 'started');
  assert.equal(queue.addCount, 1);
});

test('skips plan limit when planMaxStreams is not provided (backward compatible)', async () => {
  const redis = new FakeRedis();
  const queue = new FakeQueue();
  const stream = { id: 'stream-no-limit', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', user_id: 'owner' };

  const result = await enqueueStreamStart(startRequestOptions({
    redis, queue, stream,
  }));

  assert.equal(result.kind, 'started');
  assert.equal(queue.addCount, 1);
});

test('still deduplicates concurrent start requests with new options present', async () => {
  const redis = new FakeRedis();
  const queue = new FakeQueue();
  const stream = { id: 'stream-dedup', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value', user_id: 'owner' };
  const options = startRequestOptions({ redis, queue, stream, database: null, userId: null, planMaxStreams: null });

  const results = await Promise.all([
    enqueueStreamStart(options),
    enqueueStreamStart(options),
  ]);

  assert.equal(queue.addCount, 1);
  assert.equal([...results].filter((r) => r.kind === 'started').length, 1);
  assert.ok(results.some((r) => ['request-in-progress', 'already-running'].includes(r.kind)));
});