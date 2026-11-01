const DEFAULT_RTMP_SERVER_URL = 'rtmp://a.rtmp.youtube.com/live2';

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
 * Build each enabled output independently. The current FFmpeg tee architecture
 * broadcasts to these outputs concurrently; it does not implement failover.
 */
/** @param {StreamConfiguration} [configuration] */
export function buildStreamDestinations({
  rtmpServerUrl,
  streamKey,
  destinations = [],
  subscriptionTier = 'free',
} = {}) {
  const outputs = [buildRtmpDestination(rtmpServerUrl || DEFAULT_RTMP_SERVER_URL, streamKey)];
  const maximum = subscriptionTier === 'business' ? 4 : subscriptionTier === 'pro' ? 2 : 1;

  for (const destination of Array.isArray(destinations) ? destinations : []) {
    if (!destination?.isEnabled) continue;

    const server = typeof destination.rtmpServerUrl === 'string' ? destination.rtmpServerUrl.trim() : '';
    const key = typeof destination.streamKey === 'string' ? destination.streamKey.trim() : '';
    if (!server && !key) continue;
    if (!server || !key) {
      throw new Error('Each enabled RTMP destination needs a server URL and a stream key.');
    }

    const output = buildRtmpDestination(server, key);
    if (!outputs.includes(output) && outputs.length < maximum) outputs.push(output);
  }

  return outputs;
}

/** @param {StreamConfiguration} [configuration] */
export function validateStreamConfiguration({ rtmpServerUrl, streamKey, destinations = [] } = {}) {
  validateRtmpServerUrl(rtmpServerUrl || DEFAULT_RTMP_SERVER_URL);
  validateStreamKey(streamKey);

  for (const destination of Array.isArray(destinations) ? destinations : []) {
    if (!destination?.isEnabled) continue;
    const server = typeof destination.rtmpServerUrl === 'string' ? destination.rtmpServerUrl.trim() : '';
    const key = typeof destination.streamKey === 'string' ? destination.streamKey.trim() : '';
    if (!server && !key) continue;
    if (!server || !key) {
      throw new Error('Each enabled RTMP destination needs a server URL and a stream key.');
    }
    validateRtmpServerUrl(server);
    validateStreamKey(key);
  }
  return true;
}
