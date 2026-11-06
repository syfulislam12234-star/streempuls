function pathSegments(pathname) {
  const rawSegments = pathname.split('/');
  if (rawSegments[0] === '') rawSegments.shift();
  return rawSegments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      throw new Error('R2 object URL contains invalid path encoding.');
    }
  });
}

function configuredOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function removeExactPrefix(segments, prefix) {
  if (prefix.length > segments.length) return null;
  if (!prefix.every((segment, index) => segments[index] === segment)) return null;
  return segments.slice(prefix.length);
}

/**
 * Parse the R2 URL forms emitted by the app and S3 signer into an explicit
 * bucket/key pair. Only configured endpoint/domain and bucket-host formats are
 * accepted; path segments are never guessed away.
 * @param {string} value
 * @param {{ bucket: string, endpoint?: string, publicDomain?: string }} options
 * @returns {{ bucket: string, key: string } | null}
 */
export function parseR2ObjectUrl(value, {
  bucket,
  endpoint = '',
  publicDomain = '',
} = {}) {
  if (typeof value !== 'string' || !bucket) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;

  const bucketName = String(bucket);
  const segments = pathSegments(url.pathname);
  let keySegments = null;
  let isRecognized = false;

  const endpointUrl = configuredOrigin(endpoint);
  if (endpointUrl && url.origin.toLowerCase() === endpointUrl.origin.toLowerCase()) {
    isRecognized = true;
    const endpointPrefix = pathSegments(endpointUrl.pathname).filter(Boolean);
    const afterEndpoint = removeExactPrefix(segments, endpointPrefix);
    const afterBucket = afterEndpoint && afterEndpoint[0] === bucketName
      ? afterEndpoint.slice(1)
      : null;
    keySegments = afterBucket;
  }

  const bucketHostSuffix = '.r2.cloudflarestorage.com';
  if (!keySegments && url.hostname.toLowerCase().endsWith(bucketHostSuffix)) {
    isRecognized = true;
    const expectedPrefix = `${bucketName}.`;
    if (url.hostname.toLowerCase().startsWith(expectedPrefix.toLowerCase())) {
      keySegments = segments;
    }
  }

  if (!isRecognized) {
    const publicUrl = configuredOrigin(publicDomain);
    if (publicUrl && url.host.toLowerCase() === publicUrl.host.toLowerCase()) {
      isRecognized = true;
      keySegments = segments;
    }
  }

  if (!isRecognized) return null;
  if (!keySegments || keySegments.length === 0 || keySegments.some((segment) => segment === '..')) {
    throw new Error('R2 URL does not identify an object in the configured bucket.');
  }

  const key = keySegments.join('/');
  if (!key || key.startsWith('/')) {
    throw new Error('R2 URL does not identify a valid object key.');
  }
  return { bucket: bucketName, key };
}

/**
 * Raw stored object keys are exact by default. A bucket prefix is removed only
 * when it exactly matches the configured bucket name.
 */
export function normalizeR2ObjectKey(value, bucket) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('R2 object key is required.');
  }
  const segments = value.trim().replace(/^\/+/, '').split('/');
  const keySegments = segments[0] === bucket ? segments.slice(1) : segments;
  if (!keySegments.length || keySegments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('R2 object key is invalid.');
  }
  return keySegments.join('/');
}
