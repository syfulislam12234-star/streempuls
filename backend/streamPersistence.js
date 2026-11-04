const STREAM_COLUMNS = [
  'id', 'user_id', 'title', 'description', 'video_url', 'stream_key', 'rtmp_server_url',
  'is_looping', 'direct_copy_mode', 'status', 'ffmpeg_pid', 'worker_node_id', 'last_heartbeat',
  'uptime_seconds', 'current_bitrate_kbps', 'fps', 'cpu_usage_pct', 'mem_usage_mb', 'last_error',
  'logs', 'last_started_at', 'last_stopped_at', 'created_at', 'updated_at',
];
const DESTINATION_PLATFORMS = new Set(['youtube', 'twitch', 'kick', 'custom']);

export class StreamPersistenceError extends Error {
  constructor(code, message, databaseCode = null) {
    super(message);
    this.name = 'StreamPersistenceError';
    this.code = code;
    this.databaseCode = databaseCode;
  }
}

function databaseFailure(error, code, fallbackMessage) {
  const databaseCode = typeof error?.code === 'string' ? error.code : null;
  let message = fallbackMessage;
  if (databaseCode === '42P01' || databaseCode === 'PGRST205') {
    message = 'The Supabase stream schema is missing a required table. Apply supabase_enterprise_schema.sql.';
  } else if (databaseCode === '42703' || databaseCode === 'PGRST204') {
    message = 'The Supabase stream schema is missing a required column. Apply the latest schema migration.';
  } else if (databaseCode === '42501') {
    message = 'Supabase denied stream persistence. Configure the backend with the service-role key and do not FORCE RLS on worker tables.';
  }
  return new StreamPersistenceError(code, message, databaseCode);
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

function sameStream(existing, stream, profileId) {
  return existing.user_id === profileId
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
    throw databaseFailure(lookupError, 'DESTINATION_STORAGE_UNAVAILABLE', 'Could not verify Supabase stream destinations or permissions.');
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
    throw databaseFailure(insertError || confirmError, 'DESTINATION_PERSISTENCE_FAILED', 'Could not persist all configured stream destinations.');
  }
}

function profileDefaults(owner) {
  return {
    id: owner.id,
    email: owner.email.trim().toLowerCase(),
    full_name: typeof owner.full_name === 'string' ? owner.full_name : null,
    role: 'user',
    subscription_tier: 'free',
    subscription_status: 'unpaid',
    channel_limit: 1,
    video_limit: 1,
    duration_days: 3,
    hour_limit: 10,
    has_watermark: true,
    is_brand_free: false,
    price_bdt: 0,
  };
}

function isUnknownProfileColumn(error) {
  return error?.code === 'PGRST204' || error?.code === '42703';
}

async function findProfile(database, owner) {
  const { data: byId, error: idError } = await database
    .from('profiles').select('id,email').eq('id', owner.id).maybeSingle();
  // A local account ID may be non-UUID in the TEXT-ID deployment, while the
  // alternate schema casts profile IDs to UUID. In that case, still try the
  // exact verified email mapping instead of failing before resolving identity.
  if (idError && idError.code !== '22P02') {
    throw databaseFailure(idError, 'PROFILE_LOOKUP_FAILED', 'Could not verify the user profile in Supabase.');
  }
  if (byId) {
    if (byId.email && byId.email.trim().toLowerCase() !== owner.email.trim().toLowerCase()) {
      throw new StreamPersistenceError('PROFILE_ID_CONFLICT', 'The local user ID belongs to a different Supabase profile.');
    }
    return byId;
  }

  const { data: byEmail, error: emailError } = await database
    .from('profiles').select('id,email').eq('email', owner.email.trim().toLowerCase()).maybeSingle();
  if (emailError) {
    throw databaseFailure(emailError, 'PROFILE_LOOKUP_FAILED', 'Could not verify the user profile in Supabase.');
  }
  return byEmail || null;
}

async function insertProfile(database, profile) {
  return database.from('profiles').insert(profile).select('id,email').maybeSingle();
}

/**
 * Provision only the application profile from a verified local session.
 * For the UUID/auth.users schema, require a matching existing Supabase Auth
 * identity; never invent or create a second authentication identity here.
 */
export async function ensureProfileRecord(database, owner) {
  if (typeof owner?.id !== 'string' || !owner.id
    || typeof owner.email !== 'string' || !owner.email.trim()) {
    throw new StreamPersistenceError('PROFILE_IDENTITY_REQUIRED', 'A verified local account ID and email are required to provision a Supabase profile.');
  }

  const existing = await findProfile(database, owner);
  if (existing) return existing;

  let result = await insertProfile(database, profileDefaults(owner));
  if (result.error && isUnknownProfileColumn(result.error)) {
    if (typeof database.auth?.admin?.getUserById !== 'function') {
      throw new StreamPersistenceError('PROFILE_SCHEMA_UNSUPPORTED', 'The deployed profile schema requires a matching Supabase Auth user.');
    }
    const { data: authData, error: authError } = await database.auth.admin.getUserById(owner.id);
    const authUser = authData?.user;
    if (authError || !authUser
      || authUser.email?.trim().toLowerCase() !== owner.email.trim().toLowerCase()) {
      throw new StreamPersistenceError('SUPABASE_AUTH_USER_REQUIRED', 'A matching Supabase Auth user is required by the deployed profile schema.');
    }
    result = await insertProfile(database, {
      id: authUser.id,
      email: authUser.email,
      full_name: typeof owner.full_name === 'string' ? owner.full_name : null,
      role: 'user',
    });
  }

  if (result.error) {
    const concurrent = await findProfile(database, owner).catch(() => null);
    if (concurrent) return concurrent;
    if (result.error.code === '23503') {
      throw databaseFailure(
        result.error,
        'PROFILE_NOT_FOUND',
        'Supabase rejected the profile foreign key. The UUID/Auth-linked schema requires a matching auth.users identity; this custom-auth backend requires the text-ID enterprise profile schema.',
      );
    }
    throw databaseFailure(result.error, 'PROFILE_PROVISION_FAILED', 'Could not create the default Supabase profile.');
  }

  if (result.data) return result.data;
  const confirmed = await findProfile(database, owner);
  if (!confirmed) {
    throw new StreamPersistenceError('PROFILE_PROVISION_UNCONFIRMED', 'The Supabase profile insert could not be confirmed.');
  }
  return confirmed;
}

/** Insert a missing parent and relational destinations; never update an existing parent. */
export async function ensureStreamRecord(database, stream, owner) {
  if (!database?.from || typeof stream?.id !== 'string' || !stream.id) {
    throw new TypeError('A database client and stream ID are required.');
  }

  const destinations = normalizedDestinations(stream);
  const profile = await ensureProfileRecord(database, owner);
  const profileId = profile.id;
  const databaseStream = { ...stream, user_id: profileId };
  const { data: existing, error: lookupError } = await database
    .from('streams')
    .select('id,user_id,video_url,stream_key,rtmp_server_url')
    .eq('id', stream.id)
    .maybeSingle();
  if (lookupError) {
    throw databaseFailure(lookupError, 'STREAM_LOOKUP_FAILED', 'Could not verify the stream record in Supabase.');
  }
  if (existing) {
    if (!sameStream(existing, databaseStream, profileId)) {
      throw new StreamPersistenceError('STREAM_CONFIGURATION_MISMATCH', 'The existing Supabase stream differs in owner or source; no data was overwritten.');
    }
    await persistDestinations(database, destinations, stream.id);
    return false;
  }

  const { error: insertError } = await database.from('streams').insert(buildStreamInsertPayload(databaseStream));
  let inserted = !insertError;
  if (insertError) {
    const { data: concurrent, error: confirmError } = await database
      .from('streams').select('id,user_id,video_url,stream_key,rtmp_server_url').eq('id', stream.id).maybeSingle();
    if (confirmError || !concurrent || !sameStream(concurrent, databaseStream, profileId)) {
      if (insertError.code === '23503') {
        throw databaseFailure(insertError, 'PROFILE_NOT_FOUND', 'The stream owner profile is missing from Supabase; the stream was not queued.');
      }
      throw databaseFailure(insertError || confirmError, 'STREAM_INSERT_FAILED', 'Could not persist the stream record in Supabase.');
    }
    inserted = false;
  }

  await persistDestinations(database, destinations, stream.id);
  return inserted;
}
