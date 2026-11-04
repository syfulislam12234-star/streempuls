import { createHash, timingSafeEqual } from 'node:crypto';
import { supabase } from './supabase.js';

/** Fetch all users from Supabase users table for authentication. */
export async function fetchUsersFromSupabase() {
  try {
    const { data, error } = await supabase.from('users').select('*');
    if (error) {
      console.warn('[Supabase] Failed to fetch users:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('[Supabase] Error fetching users:', err.message);
    return [];
  }
};

/** Resolve a Bearer token against Supabase user data. */
export function authenticateBearerToken(authorization, users) {
  const match = typeof authorization === 'string'
    ? authorization.match(/^Bearer\s+([^\s]+)$/i)
    : null;
  if (!match) return null;

  const presentedHash = tokenHash(match[1]);
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
export function createStreamAuthMiddleware() {
  return async (req, res, next) => {
    const users = await fetchUsersFromSupabase();
    const user = authenticateBearerToken(req.get('authorization'), users);
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required.' });
    req.streamUser = user;
    return next();
  };
};

/** Return null for absent/foreign records so callers can respond with a non-enumerating 404. */
export function getAuthorizedStream(user, streams, streamId) {
  const stream = (Array.isArray(streams) ? streams : []).find((candidate) => candidate.id === streamId);
  return canAccessStream(user, stream) ? stream : null;
}