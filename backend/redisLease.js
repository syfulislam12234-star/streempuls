import { randomUUID } from 'node:crypto';

const RENEW_IF_OWNER_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_IF_OWNER_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Acquire a token-owned Redis lease. Returns null when another owner holds it. */
export async function acquireRedisLease(redis, key, {
  ttlMs = 30_000,
  renewIntervalMs = Math.max(1_000, Math.floor(ttlMs / 3)),
  token = randomUUID(),
  onLost,
} = {}) {
  if (!redis || typeof redis.set !== 'function' || typeof redis.eval !== 'function') {
    throw new TypeError('A Redis client supporting SET and EVAL is required for distributed leases.');
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000) {
    throw new RangeError('Redis lease TTL must be at least 1000ms.');
  }

  const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (acquired !== 'OK') return null;

  let released = false;
  let lost = false;
  let renewalInFlight = false;
  const lostHandlers = new Set(onLost ? [onLost] : []);

  const markLost = (error) => {
    if (lost || released) return;
    lost = true;
    clearInterval(renewalTimer);
    for (const handler of lostHandlers) {
      try {
        Promise.resolve(handler(error)).catch(() => {});
      } catch {
        // Lock-loss handling is best-effort; callers must stop protected work.
      }
    }
  };

  const renewNow = async () => {
    if (released || lost || renewalInFlight) return false;
    renewalInFlight = true;
    try {
      const renewed = await redis.eval(RENEW_IF_OWNER_SCRIPT, 1, key, token, String(ttlMs));
      if (Number(renewed) !== 1) {
        markLost(new Error('Distributed lease ownership was lost.'));
        return false;
      }
      return true;
    } catch {
      markLost(new Error('Distributed lease could not be renewed; protected work must stop.'));
      return false;
    } finally {
      renewalInFlight = false;
    }
  };

  const renewalTimer = setInterval(() => { void renewNow(); }, renewIntervalMs);
  renewalTimer.unref?.();

  return {
    key,
    token,
    get lost() { return lost; },
    get released() { return released; },
    onLost(handler) {
      if (typeof handler !== 'function') throw new TypeError('Lease loss handler must be a function.');
      if (lost) {
        Promise.resolve().then(() => handler(new Error('Distributed lease ownership was lost.'))).catch(() => {});
        return () => {};
      }
      lostHandlers.add(handler);
      return () => lostHandlers.delete(handler);
    },
    renewNow,
    async release() {
      if (released) return false;
      released = true;
      clearInterval(renewalTimer);
      try {
        return Number(await redis.eval(RELEASE_IF_OWNER_SCRIPT, 1, key, token)) === 1;
      } catch {
        // If Redis is unreachable, the lease expires naturally; never issue an unowned DEL.
        return false;
      }
    },
  };
}

export async function withRedisLease(redis, key, callback, options = {}) {
  const lease = await acquireRedisLease(redis, key, options);
  if (!lease) return { acquired: false };
  try {
    return { acquired: true, value: await callback(lease) };
  } finally {
    await lease.release();
  }
}
