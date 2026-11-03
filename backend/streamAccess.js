import { createHash, timingSafeEqual } from 'node:crypto';

function tokenHash(token) {
  return createHash('sha256').update(token).digest();
}

/** Resolve a local Bearer token against the persisted hash; caller-provided IDs are never used. */
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
}

export function isStreamAdmin(user) {
  return user?.role === 'admin' || user?.role === 'super_admin';
}

/** Ownerless legacy records are visible only to an authenticated administrator. */
export function canAccessStream(user, stream) {
  if (!user || !stream) return false;
  if (isStreamAdmin(user)) return true;
  return typeof stream.user_id === 'string'
    && stream.user_id.length > 0
    && stream.user_id === user.id;
}

export function getAccessibleStreams(user, streams) {
  return (Array.isArray(streams) ? streams : []).filter((stream) => canAccessStream(user, stream));
}

/** Express middleware factory, injectable for tests without starting the API listener. */
export function createStreamAuthMiddleware(getUsers) {
  return (req, res, next) => {
    const user = authenticateBearerToken(req.get('authorization'), getUsers());
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required.' });
    req.streamUser = user;
    return next();
  };
}

/** Return null for absent/foreign records so callers can respond with a non-enumerating 404. */
export function getAuthorizedStream(user, streams, streamId) {
  const stream = (Array.isArray(streams) ? streams : []).find((candidate) => candidate.id === streamId);
  return canAccessStream(user, stream) ? stream : null;
}
