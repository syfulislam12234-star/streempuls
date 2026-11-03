import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileStaleStreamRecords } from '../streamOwnership.js';

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
