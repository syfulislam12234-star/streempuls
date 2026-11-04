import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabase } from './supabase.js';

const USERS_FILE = path.join(
  process.env.DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data'),
  'users.json',
);

function readLocalUsers() {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

/** Fetch all users from Supabase users table for authentication. */
export async function fetchUsersFromSupabase() {
  let databaseUsers = [];
  try {
    const { data, error } = await supabase.from('users').select('*');
    if (error) {
      console.warn('[Supabase] Failed to fetch users:', error.message);
    } else if (Array.isArray(data)) {
      databaseUsers = data;
    }
  } catch (err) {
    console.warn('[Supabase] Error fetching users:', err.message);
  }

  // The backend's current signup flow also persists locally. Merge that source
  // so sessions remain usable during DB outages and before older users sync.
  const usersById = new Map(databaseUsers.map((user) => [user.id, user]));
  for (const user of readLocalUsers()) usersById.set(user.id, { ...usersById.get(user.id), ...user });
  return [...usersById.values()];
}

/** Persist this app's custom-auth user record for API/worker authentication. */
export async function upsertUserToSupabase(user, database = supabase) {
  const requiredFields = ['id', 'email', 'password_hash', 'password_salt', 'auth_token_hash'];
  const missingFields = requiredFields.filter((field) =>
    typeof user?.[field] !== 'string' || user[field].trim().length === 0,
  );
  if (missingFields.length > 0) {
    throw new TypeError(`Cannot sync user: required fields are missing (${missingFields.join(', ')}).`);
  }

  const role = user.role === 'admin' || user.role === 'super_admin' ? user.role : 'user';
  const subscriptionTier = typeof user.subscription_tier === 'string' ? user.subscription_tier : 'free';
  const now = new Date().toISOString();
  const payload = {
    id: user.id.trim(),
    email: user.email.trim().toLowerCase(),
    full_name: typeof user.full_name === 'string' && user.full_name.trim() ? user.full_name.trim() : user.email.trim().split('@')[0],
    role,
    admin: role === 'admin' || role === 'super_admin',
    subscription_tier: subscriptionTier,
    subscription_status: typeof user.subscription_status === 'string' ? user.subscription_status : 'unpaid',
    business: user.business === true || subscriptionTier === 'business',
    channel_limit: user.channel_limit ?? 1,
    video_limit: user.video_limit ?? 1,
    duration_days: user.duration_days ?? 3,
    hour_limit: user.hour_limit ?? 10,
    has_watermark: user.has_watermark ?? true,
    is_brand_free: user.is_brand_free ?? false,
    price_bdt: user.price_bdt ?? 0,
    password_hash: user.password_hash,
    password_salt: user.password_salt,
    auth_token_hash: user.auth_token_hash,
    expires_at: user.expires_at ?? null,
    referral_code: user.referral_code ?? null,
    referred_by_code: user.referred_by_code ?? null,
    reward_credits_bdt: user.reward_credits_bdt ?? 0,
    trial_days_bonus: user.trial_days_bonus ?? 0,
    created_at: user.created_at || now,
    updated_at: user.updated_at || now,
  };

  try {
    const { error } = await database.from('users').upsert(payload, { onConflict: 'id' });
    if (error) throw error;
  } catch (error) {
    // Log the original PostgREST/PostgreSQL error object intact for diagnosis;
    // keep the response returned to the browser free of database internals.
    console.error('[Supabase] Failed to persist new user; exact Supabase error object follows:');
    console.error(error);
    throw new Error('Unable to save the account profile to Supabase. Please try again later.', { cause: error });
  }
}

/** Resolve a Bearer token against Supabase user data. */
export function authenticateBearerToken(authorization, users) {
  const match = typeof authorization === 'string'
    ? authorization.match(/^Bearer\s+([^\s]+)$/i)
    : null;
  if (!match) return null;

  const presentedHash = createHash('sha256').update(match[1]).digest();
  return (Array.isArray(users) ? users : []).find((user) => {
    if (typeof user?.auth_token_hash !== 'string' || !/^[a-f\d]{64}$/i.test(user.auth_token_hash)) return false;
    return timingSafeEqual(presentedHash, Buffer.from(user.auth_token_hash, 'hex'));
  }) || null;
};

/** Check if a user has admin role. */
export function isStreamAdmin(user) {
  return user?.role === 'admin' || user?.role === 'super_admin';
};

/** Ownerless legacy records are visible only to an authenticated administrator. */
export function canAccessStream(user, stream) {
  if (!user || !stream) return false;
  if (isStreamAdmin(user)) return true;
  return typeof stream.user_id === 'string'
    && stream.user_id.length > 0
    && stream.user_id === user.id;
};

/** Get accessible streams for a user. */
export function getAccessibleStreams(user, streams) {
  return (Array.isArray(streams) ? streams : []).filter((stream) => canAccessStream(user, stream));
};

/** Express middleware factory, injectable for tests without starting the API listener. */
export function createStreamAuthMiddleware(getUsers = fetchUsersFromSupabase) {
  return (req, res, next) => {
    const authenticate = (users) => {
      const user = authenticateBearerToken(req.get('authorization'), users);
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required.' });
      req.streamUser = user;
      return next();
    };

    try {
      const users = getUsers();
      return users && typeof users.then === 'function'
        ? users.then(authenticate).catch(next)
        : authenticate(users);
    } catch (error) {
      return next(error);
    }
  };
};

/** Return null for absent/foreign records so callers can respond with a non-enumerating 404. */
export function getAuthorizedStream(user, streams, streamId) {
  const stream = (Array.isArray(streams) ? streams : []).find((candidate) => candidate.id === streamId);
  return canAccessStream(user, stream) ? stream : null;
}