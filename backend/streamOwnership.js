const DEFAULT_STALE_AFTER_MS = 30_000;

function asTimestamp(value) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * A stream owner is considered current only while it is refreshing its
 * heartbeat. This is intentionally conservative: missing or malformed
 * heartbeats are never stolen automatically.
 */
/**
 * @param {unknown} value
 * @param {{ now?: number, staleAfterMs?: number }} [options]
 */
export function hasFreshHeartbeat(value, {
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  const timestamp = asTimestamp(value);
  return timestamp !== null && timestamp >= now - staleAfterMs;
}

export function isStaleHeartbeat(value, options = {}) {
  return !hasFreshHeartbeat(value, options);
}

/**
 * Clear only stale active records for one owner. Each update is fenced by the
 * exact row state observed, so a fresh worker cannot be released accidentally.
 * @param {any} database
 * @param {{ userId: string, exceptStreamId?: string | null, now?: number, staleAfterMs?: number }} options
 */
export async function reconcileStaleStreamRecords(database, {
  userId,
  exceptStreamId = null,
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  if (!database?.from || typeof userId !== 'string' || !userId) return 0;

  const { data: rows, error: lookupError } = await database
    .from('streams')
    .select('id,user_id,status,worker_node_id,last_heartbeat')
    .eq('user_id', userId)
    .in('status', ['queued', 'starting', 'live', 'reconnecting']);
  if (lookupError) throw lookupError;

  let cleared = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.id === exceptStreamId || !isStaleHeartbeat(row.last_heartbeat, { now, staleAfterMs })) continue;

    let query = database.from('streams').update({
      status: 'idle',
      ffmpeg_pid: null,
      worker_node_id: null,
      last_error: 'Previous stream owner heartbeat expired; stale state reclaimed.',
      updated_at: new Date(now).toISOString(),
    }).eq('id', row.id).eq('user_id', userId).eq('status', row.status);
    query = row.worker_node_id
      ? query.eq('worker_node_id', row.worker_node_id)
      : query.is('worker_node_id', null);
    query = row.last_heartbeat
      ? query.eq('last_heartbeat', row.last_heartbeat)
      : query.is('last_heartbeat', null);

    const { data, error } = await query.select('id').maybeSingle();
    if (error) throw error;
    if (data) cleared++;
  }
  return cleared;
}

/**
 * Atomically claim a persisted stream record. The conditional update prevents
 * two runtimes that observed the same row from both becoming owners.
 *
 * Ownership is stored in the existing worker_node_id column as an opaque
 * fencing token. Node identity remains available in worker logs/heartbeats;
 * the database field must be a token so every future write can be fenced.
 */
/**
 * @param {any} database
 * @param {{ streamId: string, token: string, updates?: Record<string, unknown>, now?: number, staleAfterMs?: number }} options
 */
export async function claimStreamOwnership(database, {
  streamId,
  token,
  updates = {},
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  if (!database?.from || typeof streamId !== 'string' || !streamId || typeof token !== 'string' || !token) {
    throw new TypeError('A database client, stream ID, and ownership token are required.');
  }

  const { data: current, error: readError } = await database
    .from('streams')
    .select('id,status,worker_node_id,last_heartbeat')
    .eq('id', streamId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return false;

  const currentToken = typeof current.worker_node_id === 'string' && current.worker_node_id
    ? current.worker_node_id
    : null;
  if (currentToken && currentToken !== token && hasFreshHeartbeat(current.last_heartbeat, { now, staleAfterMs }) && current.status !== 'idle') {
    return false;
  }

  let query = database
    .from('streams')
    .update({ ...updates, worker_node_id: token })
    .eq('id', streamId);

  // Compare the value that was read. This is the fencing step: if another
  // caller wins between SELECT and UPDATE, this conditional update affects no
  // rows and the caller must not launch or continue FFmpeg.
  query = currentToken
    ? query.eq('worker_node_id', currentToken)
    : query.is('worker_node_id', null);
  if (current.status === null || current.status === undefined) query = query.is('status', null);
  else query = query.eq('status', current.status);

  const { data, error } = await query.select('id').maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * Apply a state transition only when this process still owns the stream. A
 * release is also fenced before clearing the token, so an old owner cannot
 * clear a newer owner's claim.
 */
/**
 * @param {any} database
 * @param {{ streamId: string, token: string, updates?: Record<string, unknown>, release?: boolean }} options
 */
export async function updateStreamWhenOwned(database, {
  streamId,
  token,
  updates = {},
  release = false,
} = {}) {
  if (!database?.from || typeof streamId !== 'string' || !streamId || typeof token !== 'string' || !token) {
    throw new TypeError('A database client, stream ID, and ownership token are required.');
  }

  const payload = release ? { ...updates, worker_node_id: null } : updates;
  const { data, error } = await database
    .from('streams')
    .update(payload)
    .eq('id', streamId)
    .eq('worker_node_id', token)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export { DEFAULT_STALE_AFTER_MS };
