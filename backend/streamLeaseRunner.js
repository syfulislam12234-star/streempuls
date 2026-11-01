import { acquireRedisLease } from './redisLease.js';

export const STREAM_LEASE_TTL_MS = 30_000;
export const STREAM_LEASE_RENEW_INTERVAL_MS = 8_000;

export function getStreamLeaseKey(streamId) {
  return `streempulse:active-stream:${streamId}`;
}

/** Run one stream job only while this process owns its renewable Redis lease. */
export async function runWithStreamLease({ redis, streamId, workerId, run, onLeaseLost }) {
  const lease = await acquireRedisLease(redis, getStreamLeaseKey(streamId), {
    ttlMs: STREAM_LEASE_TTL_MS,
    renewIntervalMs: STREAM_LEASE_RENEW_INTERVAL_MS,
    onLost: onLeaseLost,
  });
  if (!lease) return { acquired: false };

  try {
    return { acquired: true, value: await run(lease) };
  } finally {
    await lease.release();
  }
}
