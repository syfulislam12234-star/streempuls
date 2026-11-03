const STREAM_COLUMNS = [
  'id', 'user_id', 'title', 'description', 'video_url', 'stream_key', 'rtmp_server_url',
  'is_looping', 'direct_copy_mode', 'status', 'ffmpeg_pid', 'worker_node_id', 'last_heartbeat',
  'uptime_seconds', 'current_bitrate_kbps', 'fps', 'cpu_usage_pct', 'mem_usage_mb', 'last_error',
  'logs', 'last_started_at', 'last_stopped_at', 'created_at', 'updated_at',
];
const DESTINATION_PLATFORMS = new Set(['youtube', 'twitch', 'kick', 'custom']);

export class StreamPersistenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StreamPersistenceError';
    this.code = code;
  }
}

/** Project only base streams-table columns; destinations use stream_destinations. */
export function buildStreamInsertPayload(stream) {
  return Object.fromEntries(STREAM_COLUMNS
    .filter((column) => Object.hasOwn(stream, column) && stream[column] !== undefined)
    .map((column) => [column, stream[column]]));
}

function normalizedDestinations(stream) {
  if (!Array.isArray(stream.destinations)) return [];
  return stream.destinations.flatMap((destination) => {
    const hasRequiredValues = DESTINATION_PLATFORMS.has(destination?.platform)
      && typeof destination?.label === 'string' && destination.label.trim()
      && typeof destination?.rtmpServerUrl === 'string' && destination.rtmpServerUrl.trim()
      && typeof destination?.streamKey === 'string' && destination.streamKey.trim()
      && typeof destination?.isEnabled === 'boolean';
    // Disabled, incomplete placeholder entries were historically ignored by
    // stream destination construction and cannot satisfy the relational NOT NULL columns.
    if (!destination?.isEnabled && !hasRequiredValues) return [];
    if (!hasRequiredValues) {
      throw new StreamPersistenceError('INVALID_DESTINATION', 'A destination is missing valid platform, label, server, key, or enabled values.');
    }
    return [{
      stream_id: stream.id,
      platform: destination.platform,
      destination_label: destination.label.trim(),
      rtmp_server_url: destination.rtmpServerUrl.trim(),
      stream_key: destination.streamKey.trim(),
      is_enabled: destination.isEnabled,
    }];
  });
}

function sameStream(existing, stream) {
  return existing.user_id === stream.user_id
    && existing.video_url === stream.video_url
    && existing.stream_key === stream.stream_key
    && existing.rtmp_server_url === stream.rtmp_server_url;
}

function sameDestination(left, right) {
  return left.platform === right.platform
    && left.destination_label === right.destination_label
    && left.rtmp_server_url === right.rtmp_server_url
    && left.stream_key === right.stream_key
    && left.is_enabled === right.is_enabled;
}

async function persistDestinations(database, destinations, streamId) {
  if (destinations.length === 0) return;

  const columns = 'stream_id,platform,destination_label,rtmp_server_url,stream_key,is_enabled';
  const { data: existing, error: lookupError } = await database
    .from('stream_destinations').select(columns).eq('stream_id', streamId);
  if (lookupError) {
    throw new StreamPersistenceError('DESTINATION_STORAGE_UNAVAILABLE', 'Could not verify Supabase stream destinations or permissions.');
  }

  const rows = Array.isArray(existing) ? existing : [];
  if (rows.some((row) => !destinations.some((destination) => sameDestination(row, destination)))) {
    throw new StreamPersistenceError('DESTINATION_CONFIGURATION_MISMATCH', 'Existing Supabase destinations differ; no destination rows were changed.');
  }
  const missing = destinations.filter((destination) => !rows.some((row) => sameDestination(row, destination)));
  if (missing.length === 0) return;

  const { error: insertError } = await database.from('stream_destinations').insert(missing);
  if (!insertError) return;

  const { data: confirmed, error: confirmError } = await database
    .from('stream_destinations').select(columns).eq('stream_id', streamId);
  const confirmedRows = Array.isArray(confirmed) ? confirmed : [];
  if (confirmError || destinations.some((destination) => !confirmedRows.some((row) => sameDestination(row, destination)))) {
    throw new StreamPersistenceError('DESTINATION_PERSISTENCE_FAILED', 'Could not persist all configured stream destinations.');
  }
}

/** Insert a missing parent and relational destinations; never update an existing parent. */
export async function ensureStreamRecord(database, stream) {
  if (!database?.from || typeof stream?.id !== 'string' || !stream.id) {
    throw new TypeError('A database client and stream ID are required.');
  }
  if (typeof stream.user_id !== 'string' || !stream.user_id) {
    throw new StreamPersistenceError('STREAM_OWNER_REQUIRED', 'This legacy stream has no verified owner and cannot be queued.');
  }

  const destinations = normalizedDestinations(stream);
  const { data: existing, error: lookupError } = await database
    .from('streams')
    .select('id,user_id,video_url,stream_key,rtmp_server_url')
    .eq('id', stream.id)
    .maybeSingle();
  if (lookupError) {
    throw new StreamPersistenceError('STREAM_LOOKUP_FAILED', 'Could not verify the stream record in Supabase.');
  }
  if (existing) {
    if (!sameStream(existing, stream)) {
      throw new StreamPersistenceError('STREAM_CONFIGURATION_MISMATCH', 'The existing Supabase stream differs in owner or source; no data was overwritten.');
    }
    await persistDestinations(database, destinations, stream.id);
    return false;
  }

  const { data: profile, error: profileError } = await database
    .from('profiles').select('id').eq('id', stream.user_id).maybeSingle();
  if (profileError) {
    throw new StreamPersistenceError('PROFILE_LOOKUP_FAILED', 'Could not verify the stream owner profile in Supabase.');
  }
  if (!profile) {
    throw new StreamPersistenceError('PROFILE_NOT_FOUND', 'The stream owner profile is missing from Supabase; the stream was not queued.');
  }

  const { error: insertError } = await database.from('streams').insert(buildStreamInsertPayload(stream));
  let inserted = !insertError;
  if (insertError) {
    const { data: concurrent, error: confirmError } = await database
      .from('streams').select('id,user_id,video_url,stream_key,rtmp_server_url').eq('id', stream.id).maybeSingle();
    if (confirmError || !concurrent || !sameStream(concurrent, stream)) {
      if (insertError.code === '23503') {
        throw new StreamPersistenceError('PROFILE_NOT_FOUND', 'The stream owner profile is missing from Supabase; the stream was not queued.');
      }
      throw new StreamPersistenceError('STREAM_INSERT_FAILED', 'Could not persist the stream record in Supabase.');
    }
    inserted = false;
  }

  await persistDestinations(database, destinations, stream.id);
  return inserted;
}
