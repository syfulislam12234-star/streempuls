import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileStaleStreamRecords, reconcileUserStreamsForStart } from '../streamOwnership.js';

class Query {
  constructor(db, action, payload) {
    this.db = db;
    this.action = action;
    this.payload = payload;
    this.filters = [];
  }
  select() { return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
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
  constructor(rows) { this.rows = rows; }
  from(table) {
    assert.equal(table, 'streams');
    return {
      select: () => new Query(this, 'select'),
      update: (payload) => new Query(this, 'update', payload),
      delete: () => new Query(this, 'delete'),
    };
  }
}

test('reclaims stale rows but preserves fresh and unrelated rows', async () => {
  const now = Date.now();
  const database = new FakeDatabase([
    { id: 'stale', user_id: 'owner', status: 'live', worker_node_id: 'old-token', last_heartbeat: new Date(now - 31_000).toISOString() },
    { id: 'fresh', user_id: 'owner', status: 'live', worker_node_id: 'fresh-token', last_heartbeat: new Date(now - 1_000).toISOString() },
    { id: 'other', user_id: 'other', status: 'live', worker_node_id: 'other-token', last_heartbeat: new Date(now - 60_000).toISOString() },
  ]);

  assert.equal(await reconcileStaleStreamRecords(database, { userId: 'owner', now }), 1);
  assert.equal(database.rows.find((row) => row.id === 'stale').status, 'idle');
  assert.equal(database.rows.find((row) => row.id === 'stale').worker_node_id, null);
  assert.equal(database.rows.find((row) => row.id === 'fresh').status, 'live');
  assert.equal(database.rows.find((row) => row.id === 'other').status, 'live');
});

test('missing heartbeat is reclaimed and the selected stream can be excluded', async () => {
  const database = new FakeDatabase([
    { id: 'selected', user_id: 'owner', status: 'starting', worker_node_id: null, last_heartbeat: null },
    { id: 'orphan', user_id: 'owner', status: 'queued', worker_node_id: null, last_heartbeat: null },
  ]);

  assert.equal(await reconcileStaleStreamRecords(database, { userId: 'owner', exceptStreamId: 'selected' }), 1);
  assert.equal(database.rows.find((row) => row.id === 'selected').status, 'starting');
  assert.equal(database.rows.find((row) => row.id === 'orphan').status, 'idle');
});

test('reconcileUserStreamsForStart deletes terminal records and reclaims stale active records', async () => {
  const now = Date.now();
  const database = new FakeDatabase([
    { id: 'failed-1', user_id: 'owner', status: 'failed', worker_node_id: 'old', last_heartbeat: new Date(now - 60_000).toISOString() },
    { id: 'stopped-1', user_id: 'owner', status: 'stopped', worker_node_id: 'old2', last_heartbeat: new Date(now - 60_000).toISOString() },
    { id: 'stale-live', user_id: 'owner', status: 'live', worker_node_id: 'old3', last_heartbeat: new Date(now - 60_000).toISOString() },
    { id: 'fresh-live', user_id: 'owner', status: 'live', worker_node_id: 'fresh', last_heartbeat: new Date(now - 1_000).toISOString() },
    { id: 'other-user-failed', user_id: 'other', status: 'failed', worker_node_id: 'other-old', last_heartbeat: new Date(now - 60_000).toISOString() },
    { id: 'target', user_id: 'owner', status: 'idle', last_heartbeat: null },
  ]);

  const result = await reconcileUserStreamsForStart(database, {
    userId: 'owner',
    exceptStreamId: 'target',
    now,
  });

  assert.equal(result.deleted, 2); // failed-1 and stopped-1
  assert.equal(result.reclaimed, 1); // stale-live only (fresh-live preserved, other-user-failed is other user)

  assert.equal(database.rows.find((r) => r.id === 'stale-live').status, 'idle');
  assert.equal(database.rows.find((r) => r.id === 'stale-live').worker_node_id, null);
  assert.equal(database.rows.find((r) => r.id === 'fresh-live').status, 'live');
  assert.equal(database.rows.find((r) => r.id === 'fresh-live').worker_node_id, 'fresh');
  assert.equal(database.rows.find((r) => r.id === 'other-user-failed').status, 'failed');
});

test('reconcileUserStreamsForStart returns zeros for invalid input', async () => {
  assert.deepEqual(await reconcileUserStreamsForStart(null, { userId: 'owner' }), { deleted: 0, reclaimed: 0 });
  assert.deepEqual(await reconcileUserStreamsForStart({}, { userId: '' }), { deleted: 0, reclaimed: 0 });
});
