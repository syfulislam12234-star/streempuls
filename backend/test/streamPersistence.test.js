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

const sampleOwner = (stream = sampleStream()) => ({
  id: stream.user_id || '550e8400-e29b-41d4-a716-446655440001',
  email: 'creator@example.test',
  full_name: 'Creator',
});

async function assertRejectsWithCode(operation, expectedCode) {
  let caught;
  try { await operation; } catch (error) { caught = error; }
  assert.ok(caught instanceof Error, `expected rejection with code ${expectedCode}, but the operation resolved`);
  assert.equal(caught.code, expectedCode, `unexpected rejection: ${caught.message}`);
  return caught;
}

class FakeQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
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

class FakeInsert {
  constructor(db, table, payload) {
    this.db = db;
    this.table = table;
    this.payload = payload;
  }
  select() { return this; }
  async maybeSingle() { return this.execute(); }
  async execute() {
    if (this.table === 'profiles') {
      if (this.db.profileUnknownColumn && Object.hasOwn(this.payload, 'subscription_tier')) {
        return { data: null, error: { code: 'PGRST204' } };
      }
      if (this.db.profileInsertError) return { data: null, error: this.db.profileInsertError };
      this.db.profiles.push({ ...this.payload });
      return { data: { id: this.payload.id, email: this.payload.email }, error: null };
    }
    if (this.table === 'streams') {
      if (this.db.concurrentStreamInsert) {
        this.db.streams.push({ ...this.payload });
        return { data: null, error: { code: '23505' } };
      }
      if (this.db.insertError) return { data: null, error: this.db.insertError };
      this.db.streams.push({ ...this.payload });
      return { data: null, error: null };
    }
    if (this.table === 'stream_destinations') {
      if (this.db.concurrentDestinationInsert) {
        this.db.stream_destinations.push(...this.payload.map((row) => ({ ...row })));
        return { data: null, error: { code: '23505' } };
      }
      if (this.db.destinationInsertError) return { data: null, error: this.db.destinationInsertError };
      this.db.stream_destinations.push(...this.payload.map((row) => ({ ...row })));
      return { data: null, error: null };
    }
    throw new Error('Unexpected profile insert');
  }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

class FakeDatabase {
  constructor() {
    this.streams = [];
    this.profiles = [];
    this.stream_destinations = [];
    this.insertError = null;
    this.concurrentStreamInsert = false;
    this.profileInsertError = null;
    this.profileUnknownColumn = false;
    this.destinationInsertError = null;
    this.concurrentDestinationInsert = false;
    this.authUser = null;
    this.auth = { admin: { getUserById: async (id) => ({
      data: { user: this.authUser?.id === id ? this.authUser : null },
      error: null,
    }) } };
    this.rejectNonUuidProfileIds = false;
  }
  from(table) {
    assert.ok(['streams', 'profiles', 'stream_destinations'].includes(table));
    return {
      select: () => {
        const query = new FakeQuery(this, table);
        const originalMaybeSingle = query.maybeSingle.bind(query);
        query.maybeSingle = async () => {
          if (table === 'profiles' && this.rejectNonUuidProfileIds
            && query.filters.some(([column, value]) => column === 'id' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))) {
            return { data: null, error: { code: '22P02' } };
          }
          return originalMaybeSingle();
        };
        return query;
      },
      insert: (payload) => new FakeInsert(this, table, payload),
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

  assert.equal(await ensureStreamRecord(database, stream, sampleOwner(stream)), true);
  assert.equal(database.profiles.length, 1);
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

test('automatically provisions a conservative default profile for a verified local user', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream();
  const owner = sampleOwner(stream);

  await ensureStreamRecord(database, stream, owner);

  assert.deepEqual(database.profiles[0], {
    id: owner.id,
    email: owner.email,
    full_name: owner.full_name,
    role: 'user',
    subscription_tier: 'free',
    subscription_status: 'unpaid',
    channel_limit: 1,
    video_limit: 1,
    duration_days: 3,
    hour_limit: 10,
    has_watermark: true,
    is_brand_free: false,
    price_bdt: 0,
  });
});

test('resolves an ID mismatch by exact authenticated email without overwriting the profile', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream();
  const owner = sampleOwner(stream);
  const existingProfile = { id: 'canonical-profile-id', email: owner.email, role: 'user' };
  database.profiles.push(existingProfile);

  await ensureStreamRecord(database, stream, owner);

  assert.deepEqual(database.profiles, [existingProfile]);
  assert.equal(database.streams[0].user_id, existingProfile.id);
});

test('resolves non-UUID local IDs by exact email against a UUID profile schema', async () => {
  const database = new FakeDatabase();
  database.rejectNonUuidProfileIds = true;
  const stream = sampleStream({ user_id: 'local-user-id' });
  const owner = { id: 'local-user-id', email: 'creator@example.test', full_name: 'Creator' };
  const profile = { id: '550e8400-e29b-41d4-a716-446655440099', email: owner.email, role: 'user' };
  database.profiles.push(profile);

  await ensureStreamRecord(database, stream, owner);

  assert.equal(database.profiles.length, 1);
  assert.equal(database.streams[0].user_id, profile.id);
});

test('supports UUID/Auth-linked profile schema only for a matching existing Auth user', async () => {
  const database = new FakeDatabase();
  database.profileUnknownColumn = true;
  const stream = sampleStream();
  const owner = sampleOwner(stream);
  database.authUser = { id: owner.id, email: owner.email };

  await ensureStreamRecord(database, stream, owner);

  assert.deepEqual(database.profiles[0], {
    id: owner.id,
    email: owner.email,
    full_name: owner.full_name,
    role: 'user',
  });
});

test('does not create a new Supabase Auth identity when UUID schema profile is missing', async () => {
  const database = new FakeDatabase();
  database.profileUnknownColumn = true;
  const stream = sampleStream();

  await assertRejectsWithCode(ensureStreamRecord(database, stream, sampleOwner(stream)), 'SUPABASE_AUTH_USER_REQUIRED');
  assert.equal(database.profiles.length, 0);
  assert.equal(database.streams.length, 0);
});

test('preserves ignored disabled placeholder destinations without storing invalid rows', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream({ destinations: [{ platform: 'custom', label: '', rtmpServerUrl: '', streamKey: '', isEnabled: false }] });

  assert.equal(await ensureStreamRecord(database, stream, sampleOwner(stream)), true);
  assert.deepEqual(database.stream_destinations, []);
});

test('rejects incomplete enabled destinations before profile or stream insert', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream({ destinations: [{ platform: 'custom', label: '', rtmpServerUrl: '', streamKey: '', isEnabled: true }] });

  await assertRejectsWithCode(ensureStreamRecord(database, stream, sampleOwner(stream)), 'INVALID_DESTINATION');
  assert.equal(database.profiles.length, 0);
  assert.equal(database.streams.length, 0);
});

test('does not overwrite an existing stream row or its owner/ownership fields', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream({ destinations: [] });
  database.profiles.push({ id: stream.user_id, email: 'creator@example.test' });
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

  assert.equal(await ensureStreamRecord(database, stream, sampleOwner(stream)), false);
  assert.deepEqual(database.streams, [existing]);
});

test('preserves matching existing relational destinations without duplicate writes', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream();
  database.profiles.push({ id: stream.user_id, email: 'creator@example.test' });
  database.streams.push(buildStreamInsertPayload(stream));
  database.stream_destinations.push({
    stream_id: stream.id, platform: 'custom', destination_label: 'Backup',
    rtmp_server_url: 'rtmps://backup.example/app', stream_key: 'backup-private-key', is_enabled: true,
  });

  assert.equal(await ensureStreamRecord(database, stream, sampleOwner(stream)), false);
  assert.equal(database.stream_destinations.length, 1);
});

test('rejects a conflicting existing destination rather than mutating it', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream();
  database.profiles.push({ id: stream.user_id, email: 'creator@example.test' });
  database.streams.push(buildStreamInsertPayload(stream));
  const priorDestination = {
    stream_id: stream.id, platform: 'custom', destination_label: 'Old Backup',
    rtmp_server_url: 'rtmps://old.example/app', stream_key: 'old-key', is_enabled: true,
  };
  database.stream_destinations.push(priorDestination);

  await assertRejectsWithCode(ensureStreamRecord(database, stream, sampleOwner(stream)), 'DESTINATION_CONFIGURATION_MISMATCH');
  assert.deepEqual(database.stream_destinations, [priorDestination]);
});

test('rejects a conflicting existing stream rather than overwriting it', async () => {
  const database = new FakeDatabase();
  const stream = sampleStream({ destinations: [] });
  database.profiles.push({ id: stream.user_id, email: 'creator@example.test' });
  database.streams.push({ ...buildStreamInsertPayload(stream), stream_key: 'different-key' });

  await assertRejectsWithCode(ensureStreamRecord(database, stream, sampleOwner(stream)), 'STREAM_CONFIGURATION_MISMATCH');
});

test('confirms a concurrent parent insert and then verifies relational destinations', async () => {
  const database = new FakeDatabase();
  database.concurrentStreamInsert = true;
  const stream = sampleStream();

  assert.equal(await ensureStreamRecord(database, stream, sampleOwner(stream)), false);
  assert.equal(database.streams.length, 1);
  assert.equal(database.stream_destinations.length, 1);
});

test('confirms a concurrent relational destination insert before reporting success', async () => {
  const database = new FakeDatabase();
  database.concurrentDestinationInsert = true;

  assert.equal(await ensureStreamRecord(database, sampleStream(), sampleOwner()), true);
  assert.equal(database.stream_destinations.length, 1);
});

test('fails if profile insert cannot be verified', async () => {
  const database = new FakeDatabase();
  database.profileInsertError = { code: '42501' };

  await assertRejectsWithCode(ensureStreamRecord(database, sampleStream(), sampleOwner()), 'PROFILE_PROVISION_FAILED');
  assert.equal(database.streams.length, 0);
});

test('maps database foreign-key errors to a safe profile failure', async () => {
  const database = new FakeDatabase();
  database.profileInsertError = { code: '23503', details: 'private FK detail' };

  const error = await assertRejectsWithCode(ensureStreamRecord(database, sampleStream(), sampleOwner()), 'PROFILE_NOT_FOUND');
  assert.doesNotMatch(error.message, /private FK detail/);
});

test('rejects a missing authenticated owner without persistence', async () => {
  const database = new FakeDatabase();
  await assertRejectsWithCode(ensureStreamRecord(database, sampleStream(), null), 'PROFILE_IDENTITY_REQUIRED');
  assert.equal(database.profiles.length, 0);
  assert.equal(database.streams.length, 0);
});

test('destination persistence failure rejects start persistence instead of claiming success', async () => {
  const database = new FakeDatabase();
  database.destinationInsertError = { code: '42P01' };

  await assertRejectsWithCode(ensureStreamRecord(database, sampleStream(), sampleOwner()), 'DESTINATION_PERSISTENCE_FAILED');
});
