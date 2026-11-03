const ACTIVE_STREAM_STATUSES = new Set(['queued', 'starting', 'live', 'reconnecting', 'stopping']);
const DEFAULT_STALE_AFTER_MS = 30_000;

function parseTimestamp(value) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isFreshStreamHeartbeat(value, now = Date.now(), staleAfterMs = DEFAULT_STALE_AFTER_MS) {
  const timestamp = parseTimestamp(value);
  return timestamp !== null && timestamp >= now - staleAfterMs;
}

/**
 * Reclaim only owner-scoped local records whose active heartbeat has expired.
 * @param {Array<Record<string, any>>} streams
 * @param {{ userId?: string, now?: number, staleAfterMs?: number }} options
 */
export function reconcileLocalStreamState(streams, {
  userId,
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  let cleared = 0;
  for (const stream of Array.isArray(streams) ? streams : []) {
    if (stream.user_id !== userId || !ACTIVE_STREAM_STATUSES.has(String(stream.status).toLowerCase())) continue;
    if (isFreshStreamHeartbeat(stream.last_heartbeat, now, staleAfterMs)) continue;

    stream.status = 'idle';
    stream.ffmpeg_pid = null;
    stream.worker_node_id = null;
    stream.last_error = 'Previous stream heartbeat expired; stale state reclaimed.';
    stream.updated_at = new Date(now).toISOString();
    cleared++;
  }
  return cleared;
}

export function countActiveStreams(streams, userId, now = Date.now(), staleAfterMs = DEFAULT_STALE_AFTER_MS) {
  return (Array.isArray(streams) ? streams : []).filter((stream) => (
    stream.user_id === userId
      && ACTIVE_STREAM_STATUSES.has(String(stream.status).toLowerCase())
      && isFreshStreamHeartbeat(stream.last_heartbeat, now, staleAfterMs)
  )).length;
}

export { ACTIVE_STREAM_STATUSES, DEFAULT_STALE_AFTER_MS };
