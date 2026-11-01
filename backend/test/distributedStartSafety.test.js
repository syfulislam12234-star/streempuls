import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueStreamStart, getStreamStartJobId } from '../streamStart.js';
import { acquireRedisLease } from '../redisLease.js';
import { runWithStreamLease } from '../streamLeaseRunner.js';

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

function startRequestOptions({ redis, queue, stream, markStarting = async (value) => { value.status = 'starting'; } }) {
  return {
    redis,
    queue,
    streamId: stream.id,
    getStream: async () => stream,
    getSubscriptionTier: async () => 'pro',
    markStarting,
  };
}

test('two concurrent Start API operations enqueue one deterministic BullMQ job', async () => {
  const redis = new FakeRedis();
  const queue = new FakeQueue();
  const stream = { id: 'stream-concurrent', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value' };
  const options = startRequestOptions({ redis, queue, stream });

  const results = await Promise.all([
    enqueueStreamStart(options),
    enqueueStreamStart(options),
  ]);

  assert.equal(queue.addCount, 1);
  assert.equal([...results].filter((result) => result.kind === 'started').length, 1);
  assert.ok(results.some((result) => ['request-in-progress', 'already-running'].includes(result.kind)));
  assert.equal(queue.jobs.has(getStreamStartJobId(stream.id)), true);
});

test('repeated Start while stream status is starting is rejected without enqueueing', async () => {
  const redis = new FakeRedis();
  const queue = new FakeQueue();
  const stream = { id: 'stream-starting', status: 'starting', video_url: '/uploads/clip.mp4', stream_key: 'key-value' };

  const result = await enqueueStreamStart(startRequestOptions({ redis, queue, stream }));
  assert.deepEqual(result, { kind: 'already-running', status: 'starting' });
  assert.equal(queue.addCount, 0);
});

test('existing legacy timestamp-ID active and waiting jobs prevent a second job', async () => {
  for (const state of ['active', 'waiting']) {
    const redis = new FakeRedis();
    const legacy = new FakeJob(`start-stream-stream-legacy-${state}-timestamp`, { streamId: 'stream-legacy' }, state);
    const queue = new FakeQueue([legacy]);
    const stream = { id: 'stream-legacy', status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value' };

    const result = await enqueueStreamStart(startRequestOptions({ redis, queue, stream }));
    assert.equal(result.kind, 'already-queued');
    assert.equal(result.jobId, legacy.id);
    assert.equal(queue.addCount, 0);
    assert.equal(stream.status, 'starting');
  }
});

test('failed and completed deterministic jobs are removed before a safe retry', async () => {
  for (const state of ['failed', 'completed']) {
    const redis = new FakeRedis();
    const id = `stream-retry-${state}`;
    const terminalJob = new FakeJob(getStreamStartJobId(id), { streamId: id }, state);
    const queue = new FakeQueue([terminalJob]);
    const stream = { id, status: 'idle', video_url: '/uploads/clip.mp4', stream_key: 'key-value' };

    const result = await enqueueStreamStart(startRequestOptions({ redis, queue, stream }));
    assert.equal(result.kind, 'started');
    assert.equal(queue.addCount, 1);
    assert.equal(terminalJob.removed, true);
  }
});

test('two worker instances competing for one stream produce only one owner', async () => {
  const redis = new FakeRedis();
  let releaseFirst;
  let firstEntered;
  const entered = new Promise((resolve) => { firstEntered = resolve; });
  const firstRun = new Promise((resolve) => { releaseFirst = resolve; });
  let starts = 0;

  const first = runWithStreamLease({
    redis,
    streamId: 'worker-race',
    workerId: 'replica-a',
    run: async () => { starts++; firstEntered(); await firstRun; },
  });
  await entered;
  const second = await runWithStreamLease({
    redis,
    streamId: 'worker-race',
    workerId: 'replica-b',
    run: async () => { starts++; },
  });

  assert.deepEqual(second, { acquired: false });
  assert.equal(starts, 1);
  releaseFirst();
  assert.equal((await first).acquired, true);
  assert.equal((await runWithStreamLease({
    redis,
    streamId: 'worker-race',
    workerId: 'replica-b',
    run: async () => { starts++; },
  })).acquired, true);
  assert.equal(starts, 2);
});

test('lease renewal extends ownership and recovery is possible after expiry', async () => {
  const redis = new FakeRedis();
  const lease = await acquireRedisLease(redis, 'lease-expiry-test', {
    ttlMs: 3_000,
    renewIntervalMs: 60_000,
    token: 'owner-one',
  });
  assert.ok(lease);

  redis.now += 2_500;
  assert.equal(await lease.renewNow(), true);
  redis.now += 2_000;
  const competing = await acquireRedisLease(redis, 'lease-expiry-test', {
    ttlMs: 3_000,
    renewIntervalMs: 60_000,
    token: 'owner-two',
  });
  assert.equal(competing, null);

  redis.now += 1_100;
  const recovered = await acquireRedisLease(redis, 'lease-expiry-test', {
    ttlMs: 3_000,
    renewIntervalMs: 60_000,
    token: 'owner-three',
  });
  assert.ok(recovered);
  await lease.release();
  assert.equal(redis.entries.get('lease-expiry-test').value, 'owner-three');
  await recovered.release();
});

test('stale lease owners cannot renew or release a successor lease', async () => {
  const redis = new FakeRedis();
  let lostError = null;
  const first = await acquireRedisLease(redis, 'lease-owner-test', {
    ttlMs: 2_000,
    renewIntervalMs: 60_000,
    token: 'first-owner',
    onLost: (error) => { lostError = error; },
  });
  redis.now += 2_100;
  const second = await acquireRedisLease(redis, 'lease-owner-test', {
    ttlMs: 2_000,
    renewIntervalMs: 60_000,
    token: 'second-owner',
  });
  assert.ok(second);

  assert.equal(await first.renewNow(), false);
  assert.match(lostError.message, /ownership was lost/i);
  assert.equal(await first.release(), false);
  assert.equal(redis.entries.get('lease-owner-test').value, 'second-owner');
  await second.release();
});
