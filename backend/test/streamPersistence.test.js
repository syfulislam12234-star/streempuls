import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStreamInsertPayload,
  ensureStreamRecord,
  StreamPersistenceError,
} from '../streamPersistence.js';

const sampleStream = (overrides = {}) => ({
  id: '550e8400-e29b-41d4-a716-446655440000',
  user_id: '550e8400-e29b-41d4-a716-446655440001',
  title: 'Private broadcast',
  description: 'description',
  video_url: 'https://storage.example/video.mp4',
  stream_key: 'private-test-key',
  rtmp_server_url: 'rtmp://a.rtmp.youtube.com/live2',
  status: 'idle',
  direct_copy_mode: true,
  is_looping: true,
  orientation: 'vertical',
  category: 'Music',
  visibility: 'scheduled',
  scheduled_for: '2030-01-01T00:00:00.000Z',
  destinations: [{
    id: 'client-id-is-not-a-db-column',
    platform: 'custom',
    label: 'Backup',
    rtmpServerUrl: 'rtmps://backup.example/app',
    streamKey: 'backup-private-key',
    isEnabled: true,
  }],
  ...overrides,
});

async function assertRejectsWithCode(operation, expectedCode) {
  let caught;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error, `expected rejection with code ${expectedCode}, but the operation resolved`);
  assert.equal(caught.code, expectedCode, `unexpected rejection: ${caught.message}`);
  return caught;
}

class FakeQuery {
  constructor(db, table, action, payload) {
    this.db = db;
    this.table = table;
    this.action = action;
    this.payload = payload;
    this.filters = [];
  }
  select(columns) { this.columns = columns; return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  async maybeSingle() {
    const row = this.db[this.table].find((item) => this.filters.every(([key, value]) => item[key] === value));
    return { data: row ? { ...row } : null, error: null };
  }
  async then(resolve, reject) {
    try {
      const rows = this.db[this.table].filter((item) => this.filters.every(([key, value]) => item[key] === value));
      resolve({ data: rows.map((row) => ({ ...row })), error: null });
    } catch (error) { reject(error); }
  }
}

class FakeDatabase {
  constructor() {
    this.streams = [];
    this.profiles = [{ id: sampleStream().user_id }];
    this.stream_destinations = [];
    this.insertError = null;
    this.concurrentStreamInsert = false;
    this.destinationInsertError = null;
    this.concurrentDestinationInsert = false;
  }
  from(table) {
    assert.ok(['streams', 'profiles', 'stream_destinations'].includes(table));
    return {
      select: (columns) => new FakeQuery(this, table, 'select').select(columns),
      insert: async (payload) => {
        if (table === 'streams') {
          if (this.concurrentStreamInsert) {
            this.streams.push({ ...payload });
            return { error: { code: '23505' } };
          }
          if (this.insertError) return { error: this.insertError };
          this.streams.push({ ...payload });
          return { error: null };
        }
        if (table === 'stream_destinations') {
          if (this.concurrentDestinationInsert) {
            this.stream_destinations.push(...payload.map((row) => ({ ...row })));
            return { error: { code: '23505' } };
          }
          if (this.destinationInsertError) return { error: this.destinationInsertError };
          this.stream_destinations.push(...payload.map((row) => ({ ...row })));
          return { error: null };
        }
        throw new Error('Unexpected profile insert');
      },
    };
  }
}

test('parent insert contains only base streams columns and persists destinations relationally', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream();
  const payload = buildStreamInsertPayload(stream);
  assert.equal(Object.hasOwn(payload, 'destinations'), false);
  assert.equal(Object.hasOwn(payload, 'orientation'), false);
  assert.equal(Object.hasOwn(payload, 'scheduled_for'), false);
  assert.equal(Object.hasOwn(payload, 'id'), true);

  assert.equal(await ensureStreamRecord(database, stream), true);
  assert.equal(database.streams.length, 1);
  assert.equal(Object.hasOwn(database.streams[0], 'destinations'), false);
  assert.deepEqual(database.stream_destinations, [{
    stream_id: stream.id,
    platform: 'custom',
    destination_label: 'Backup',
    rtmp_server_url: 'rtmps://backup.example/app',
    stream_key: 'backup-private-key',
    is_enabled: true,
  }]);
});

test('preserves ignored disabled placeholder destinations without storing invalid rows', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream({
    destinations: [
      { platform: 'custom', label: '', rtmpServerUrl: '', streamKey: '', isEnabled: false },
    ],
  });

  assert.equal(await ensureStreamRecord(database, stream), true);
  assert.deepEqual(database.stream_destinations, []);
});

test('rejects incomplete enabled destinations before any stream insert', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream({
    destinations: [{ platform: 'custom', label: '', rtmpServerUrl: '', streamKey: '', isEnabled: true }],
  });

  await assertRejectsWithCode(ensureStreamRecord(database, stream), 'INVALID_DESTINATION');
  assert.equal(database.streams.length, 0);
});

test('does not overwrite an existing stream row or its owner/ownership fields', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream({ destinations: [] });
  const existing = {
    id: stream.id,
    user_id: stream.user_id,
    video_url: stream.video_url,
    stream_key: stream.stream_key,
    rtmp_server_url: stream.rtmp_server_url,
    status: 'live',
    worker_node_id: 'current-owner',
  };
  database.streams.push(existing);

  assert.equal(await ensureStreamRecord(database, stream), false);
  assert.deepEqual(database.streams, [existing]);
});

test('preserves matching existing relational destinations without duplicate writes', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream();
  database.streams.push(buildStreamInsertPayload(stream));
  database.stream_destinations.push({
    stream_id: stream.id,
    platform: 'custom',
    destination_label: 'Backup',
    rtmp_server_url: 'rtmps://backup.example/app',
    stream_key: 'backup-private-key',
    is_enabled: true,
  });

  assert.equal(await ensureStreamRecord(database, stream), false);
  assert.equal(database.stream_destinations.length, 1);
});

test('rejects a conflicting existing destination rather than mutating it', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream();
  database.streams.push(buildStreamInsertPayload(stream));
  const priorDestination = {
    stream_id: stream.id,
    platform: 'custom',
    destination_label: 'Old Backup',
    rtmp_server_url: 'rtmps://old.example/app',
    stream_key: 'old-key',
    is_enabled: true,
  };
  database.stream_destinations.push(priorDestination);

  await assertRejectsWithCode(ensureStreamRecord(database, stream), 'DESTINATION_CONFIGURATION_MISMATCH');
  assert.deepEqual(database.stream_destinations, [priorDestination]);
});

test('rejects a conflicting existing stream rather than overwriting it', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream({ destinations: [] });
  database.streams.push({ ...buildStreamInsertPayload(stream), stream_key: 'different-key' });

  await assertRejectsWithCode(ensureStreamRecord(database, stream), 'STREAM_CONFIGURATION_MISMATCH');
});

test('confirms a concurrent parent insert and then verifies relational destinations', async () => {
  const database = new FakeDatabase();
  database.concurrentStreamInsert = true;
  const stream = sampleStream();

  assert.equal(await ensureStreamRecord(database, stream), false);
  assert.equal(database.streams.length, 1);
  assert.equal(database.stream_destinations.length, 1);
});

test('confirms a concurrent relational destination insert before reporting success', async () => {
  const database = new FakeDatabase();
  database.concurrentDestinationInsert = true;

  assert.equal(await ensureStreamRecord(database, sampleStream()), true);
  assert.equal(database.stream_destinations.length, 1);
});

test('fails explicitly when the owner profile is absent (including FK ownership requirements)', async () => {
  const database = new FakeDatabase();
  database.profiles = [];

  const error = await assertRejectsWithCode(ensureStreamRecord(database, sampleStream()), 'PROFILE_NOT_FOUND');
  assert.ok(error instanceof StreamPersistenceError);
  assert.equal(database.streams.length, 0);
});

test('maps database foreign-key errors to a safe missing-profile failure', async () => {
  const database = new FakeDatabase();
  database.insertError = { code: '23503', details: 'private FK detail' };

  const error = await assertRejectsWithCode(ensureStreamRecord(database, sampleStream()), 'PROFILE_NOT_FOUND');
  assert.doesNotMatch(error.message, /private FK detail/);
});

test('does not accept a missing legacy owner', async () => {
  const database = new FakeDatabase();
  await assertRejectsWithCode(ensureStreamRecord(database, sampleStream({ user_id: null })), 'STREAM_OWNER_REQUIRED');
  assert.equal(database.streams.length, 0);
});

test('destination persistence failure rejects start persistence instead of claiming success', async () => {
  const database = new FakeDatabase();
  database.destinationInsertError = { code: '42P01' };
  await assertRejectsWithCode(ensureStreamRecord(database, sampleStream()), 'DESTINATION_PERSISTENCE_FAILED');
});
