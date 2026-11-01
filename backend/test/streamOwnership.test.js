import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimStreamOwnership,
  hasFreshHeartbeat,
  updateStreamWhenOwned,
} from '../streamOwnership.js';

class FakeStreamQuery {
  constructor(database, action, payload) {
    this.database = database;
    this.action = action;
    this.payload = payload;
    this.filters = [];
  }

  select() { return this; }
  eq(column, value) { this.filters.push({ kind: 'eq', column, value }); return this; }
  is(column, value) { this.filters.push({ kind: 'is', column, value }); return this; }

  async maybeSingle() {
    const row = this.database.row;
    if (this.action === 'select') {
      return { data: row ? { ...row } : null, error: null };
    }
    const matches = row && this.filters.every((filter) => row[filter.column] === filter.value);
    if (!matches) return { data: null, error: null };
    this.database.row = { ...row, ...this.payload };
    return { data: { id: this.database.row.id }, error: null };
  }
}

class FakeDatabase {
  constructor(row) { this.row = row; }
  from(table) {
    assert.equal(table, 'streams');
    return {
      select: () => new FakeStreamQuery(this, 'select'),
      update: (payload) => new FakeStreamQuery(this, 'update', payload),
    };
  }
}

test('a stale owner cannot update or release a newer stream claim', async () => {
  const database = new FakeDatabase({
    id: 'stream-fence',
    status: 'live',
    worker_node_id: 'new-owner',
    last_heartbeat: new Date().toISOString(),
  });

  assert.equal(await updateStreamWhenOwned(database, {
    streamId: 'stream-fence',
    token: 'old-owner',
    updates: { status: 'ERROR', last_error: 'stale owner' },
    release: true,
  }), false);
  assert.deepEqual(database.row, {
    id: 'stream-fence',
    status: 'live',
    worker_node_id: 'new-owner',
    last_heartbeat: database.row.last_heartbeat,
  });
});

test('a conditional claim allows one owner and fences the competing claimant', async () => {
  const now = Date.now();
  const database = new FakeDatabase({
    id: 'stream-claim',
    status: 'idle',
    worker_node_id: null,
    last_heartbeat: null,
  });

  assert.equal(await claimStreamOwnership(database, {
    streamId: 'stream-claim',
    token: 'owner-one',
    updates: { status: 'starting', last_heartbeat: new Date(now).toISOString() },
    now,
  }), true);
  assert.equal(await claimStreamOwnership(database, {
    streamId: 'stream-claim',
    token: 'owner-two',
    updates: { status: 'starting', last_heartbeat: new Date(now).toISOString() },
    now,
  }), false);
  assert.equal(database.row.worker_node_id, 'owner-one');
});

test('only an expired owner can be replaced and a valid heartbeat remains protected', async () => {
  const now = Date.now();
  assert.equal(hasFreshHeartbeat(new Date(now - 1_000).toISOString(), { now }), true);
  assert.equal(hasFreshHeartbeat(new Date(now - 31_000).toISOString(), { now }), false);

  const database = new FakeDatabase({
    id: 'stream-expired',
    status: 'reconnecting',
    worker_node_id: 'expired-owner',
    last_heartbeat: new Date(now - 31_000).toISOString(),
  });
  assert.equal(await claimStreamOwnership(database, {
    streamId: 'stream-expired',
    token: 'replacement-owner',
    updates: { status: 'starting', last_heartbeat: new Date(now).toISOString() },
    now,
  }), true);
  assert.equal(database.row.worker_node_id, 'replacement-owner');
});
