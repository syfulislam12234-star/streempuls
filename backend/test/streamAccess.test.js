import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  authenticateBearerToken,
  canAccessStream,
  createStreamAuthMiddleware,
  getAccessibleStreams,
  getAuthorizedStream,
  isStreamAdmin,
  upsertUserToSupabase,
} from '../streamAccess.js';

const token = 'unit-test-session-token';
const owner = {
  id: 'owner-1',
  role: 'user',
  auth_token_hash: createHash('sha256').update(token).digest('hex'),
};
const other = {
  id: 'other-1',
  role: 'user',
  auth_token_hash: createHash('sha256').update('other-session').digest('hex'),
};
const admin = {
  id: 'admin-1',
  role: 'admin',
  auth_token_hash: createHash('sha256').update('admin-session').digest('hex'),
};
const ownerStream = { id: 's1', user_id: owner.id, stream_key: 'owner-key' };
const otherStream = { id: 's2', user_id: other.id, stream_key: 'other-key' };
const legacyStream = { id: 'legacy', stream_key: 'legacy-key' };

test('unauthenticated stream requests are rejected with 401', () => {
  const middleware = createStreamAuthMiddleware(() => [owner]);
  let responseStatus;
  let responseBody;
  let nextCalled = false;
  middleware({ get: () => undefined }, {
    status(status) { responseStatus = status; return this; },
    json(body) { responseBody = body; return this; },
  }, () => { nextCalled = true; });

  assert.equal(responseStatus, 401);
  assert.equal(responseBody.success, false);
  assert.equal(nextCalled, false);
});

test('invalid Bearer tokens are rejected even when x-user-id is supplied', () => {
  assert.equal(authenticateBearerToken('Bearer invalid-token', [owner]), null);
  const middleware = createStreamAuthMiddleware(() => [owner]);
  let responseStatus;
  middleware({ get: (name) => name === 'authorization' ? 'Bearer invalid-token' : owner.id }, {
    status(status) { responseStatus = status; return this; },
    json() { return this; },
  }, () => assert.fail('invalid token must not pass authentication'));
  assert.equal(responseStatus, 401);
});

test('a valid owner token authenticates and can access only its stream', () => {
  assert.equal(authenticateBearerToken(`Bearer ${token}`, [owner]), owner);
  assert.equal(canAccessStream(owner, ownerStream), true);
  assert.equal(canAccessStream(owner, otherStream), false);
  assert.equal(getAuthorizedStream(owner, [otherStream], otherStream.id), null);
});

test('stream list filtering prevents unrelated stream keys from being returned', () => {
  const visible = getAccessibleStreams(owner, [ownerStream, otherStream, legacyStream]);
  assert.deepEqual(visible, [ownerStream]);
  assert.equal(JSON.stringify(visible).includes('other-key'), false);
  assert.equal(JSON.stringify(visible).includes('legacy-key'), false);
});

test('verified admins can access all streams, including ownerless legacy records', () => {
  assert.equal(isStreamAdmin(admin), true);
  assert.equal(canAccessStream(admin, ownerStream), true);
  assert.equal(canAccessStream(admin, otherStream), true);
  assert.equal(canAccessStream(admin, legacyStream), true);
  assert.deepEqual(getAccessibleStreams(admin, [ownerStream, otherStream, legacyStream]), [ownerStream, otherStream, legacyStream]);
});

test('a caller-supplied admin role without a valid token does not authorize access', () => {
  const forgedAdmin = { id: 'attacker', role: 'admin' };
  assert.equal(authenticateBearerToken(undefined, [forgedAdmin]), null);
  assert.equal(canAccessStream(null, otherStream), false);
});

test('new custom-auth users are upserted into public.users with conflict handling by id', async () => {
  let insertedTable;
  let insertedUser;
  let options;
  const database = {
    from(table) {
      insertedTable = table;
      return {
        async upsert(user, upsertOptions) {
          insertedUser = user;
          options = upsertOptions;
          return { error: null };
        },
      };
    },
  };
  const user = {
    id: 'new-user',
    email: 'new@example.test',
    password_hash: 'one-way-password-hash',
    password_salt: 'salt',
    auth_token_hash: 'one-way-token-hash',
  };

  await upsertUserToSupabase(user, database);

  assert.equal(insertedTable, 'users');
  assert.equal(insertedUser, user);
  assert.deepEqual(options, { onConflict: 'id' });
});

test('Supabase user sync failures are not swallowed', async () => {
  const database = {
    from() {
      return { async upsert() { return { error: { message: 'users table unavailable' } }; } };
    },
  };

  await assert.rejects(
    upsertUserToSupabase({ id: 'new-user' }, database),
    /Unable to save the account profile to Supabase/,
  );
});
