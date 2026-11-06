const DEFAULT_RTMP_SERVER_URL = 'rtmp://a.rtmp.youtube.com/live2';
const YOUTUBE_BACKUP_SERVER_URL = 'rtmp://b.rtmp.youtube.com/live2';

/**
 * @typedef {{
 *   rtmpServerUrl?: string,
 *   streamKey?: string,
 *   isEnabled?: boolean,
 *   [key: string]: unknown,
 * }} StreamDestination
 */

/**
 * @typedef {{
 *   rtmpServerUrl?: string,
 *   streamKey?: string,
 *   destinations?: StreamDestination[],
 *   subscriptionTier?: string,
 * }} StreamConfiguration
 */

export function validateStreamKey(streamKey) {
  if (typeof streamKey !== 'string' || !streamKey.trim()) {
    throw new Error('A stream key is required.');
  }

  const key = streamKey.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(key) || key.startsWith('/')) {
    throw new Error('Enter the stream key only, not a complete RTMP URL.');
  }
  if (/[\s?#]/.test(key)) {
    throw new Error('The stream key contains unsupported characters.');
  }
  return key;
}

export function validateRtmpServerUrl(serverUrl) {
  if (typeof serverUrl !== 'string' || !serverUrl.trim()) {
    throw new Error('An RTMP server URL is required.');
  }

  const value = serverUrl.trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Enter a valid RTMP server URL.');
  }

  if (!['rtmp:', 'rtmps:'].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new Error('Enter an RTMP server URL without a stream key or query string.');
  }
  return value.replace(/\/+$/, '');
}

export function buildRtmpDestination(serverUrl, streamKey) {
  const base = validateRtmpServerUrl(serverUrl);
  const key = validateStreamKey(streamKey);
  return `${base}/${key}`;
}

/**
 * Recognize only YouTube's documented backup endpoint form. A query string is
 * otherwise rejected by the normal RTMP server URL validator.
 */
function buildYoutubeBackupDestination(serverUrl, streamKey, primaryStreamKey) {
  let parsed;
  try {
    parsed = new URL(serverUrl);
  } catch {
    return null;
  }

  if (!parsed.search && !parsed.hash) return null;
  const isExactBackup = parsed.protocol === 'rtmp:'
    && parsed.hostname === 'b.rtmp.youtube.com'
    && parsed.port === ''
    && parsed.pathname === '/live2'
    && parsed.search === '?backup=1'
    && parsed.searchParams.size === 1
    && !parsed.hash
    && !parsed.username
    && !parsed.password;
  if (!isExactBackup) {
    throw new Error('Enter the exact YouTube backup server URL: rtmp://b.rtmp.youtube.com/live2?backup=1.');
  }

  const key = validateStreamKey(streamKey);
  if (key !== validateStreamKey(primaryStreamKey)) {
    throw new Error('The YouTube backup destination must use the primary stream key.');
  }
  return `${YOUTUBE_BACKUP_SERVER_URL}/${key}?backup=1`;
}

/**
 * Build a primary output, an optional YouTube failover output, and concurrent
 * secondary outputs. The backup is deliberately excluded from the tee list.
 * @param {StreamConfiguration} [configuration]
 */
export function buildStreamDestinationPlan({
  rtmpServerUrl,
  streamKey,
  destinations = [],
  subscriptionTier = 'free',
} = {}) {
  const primary = buildRtmpDestination(rtmpServerUrl || DEFAULT_RTMP_SERVER_URL, streamKey);
  const primaryKey = validateStreamKey(streamKey);
  const outputs = [primary];
  let backup = null;
  const maximum = subscriptionTier === 'business' ? 4 : subscriptionTier === 'pro' ? 2 : 1;

  for (const destination of Array.isArray(destinations) ? destinations : []) {
    if (!destination?.isEnabled) continue;

    const server = typeof destination.rtmpServerUrl === 'string' ? destination.rtmpServerUrl.trim() : '';
    const key = typeof destination.streamKey === 'string' ? destination.streamKey.trim() : '';
    if (!server && !key) continue;
    if (!server || !key) {
      throw new Error('Each enabled RTMP destination needs a server URL and a stream key.');
    }

    const youtubeBackup = buildYoutubeBackupDestination(server, key, primaryKey);
    if (youtubeBackup) {
      if (backup && backup !== youtubeBackup) {
        throw new Error('Only one YouTube backup destination can be enabled.');
      }
      backup = youtubeBackup;
      continue;
    }

    const output = buildRtmpDestination(server, key);
    if (!outputs.includes(output) && outputs.length < maximum) outputs.push(output);
  }

  return { primary, backup, destinations: outputs };
}

/** @param {StreamConfiguration} [configuration] */
export function buildStreamDestinations(configuration = {}) {
  return buildStreamDestinationPlan(configuration).destinations;
}

/** Select the primary endpoint for one FFmpeg attempt; tee outputs stay stable. */
export function selectStreamDestinationsForAttempt(plan, { useYoutubeBackup = false } = {}) {
  if (!plan || !Array.isArray(plan.destinations) || typeof plan.primary !== 'string') {
    throw new TypeError('A valid stream destination plan is required.');
  }
  const primary = useYoutubeBackup && plan.backup ? plan.backup : plan.primary;
  return [primary, ...plan.destinations.slice(1)];
}

/** @param {StreamConfiguration} [configuration] */
export function validateStreamConfiguration({ rtmpServerUrl, streamKey, stream_key, destinations = [] } = {}) {
  const safeDestinations = Array.isArray(destinations) ? destinations : [];
  // Accept streamKey from top-level, or from destinations[0], or from stream_key (with underscore)
  const actualStreamKey = streamKey || (safeDestinations.length > 0 ? safeDestinations[0].streamKey : stream_key);
  // Accept rtmpServerUrl from top-level, or from destinations[0], or default
  const actualRtmpServerUrl = rtmpServerUrl || (safeDestinations.length > 0 ? safeDestinations[0].rtmpServerUrl : undefined) || DEFAULT_RTMP_SERVER_URL;

  buildStreamDestinationPlan({
    rtmpServerUrl: actualRtmpServerUrl,
    streamKey: actualStreamKey,
    destinations: safeDestinations,
  });
  return true;
}
