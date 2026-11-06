function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactUrls(text) {
  return text.replace(/[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi, (candidate) => {
    const trailing = candidate.match(/[),.;]+$/)?.[0] || '';
    const rawUrl = trailing ? candidate.slice(0, -trailing.length) : candidate;
    try {
      const url = new URL(rawUrl);
      if (url.protocol === 'rtmp:' || url.protocol === 'rtmps:') {
        return `[RTMP URL REDACTED]${trailing}`;
      }
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return `[HTTP URL REDACTED]${trailing}`;
      }
      return `[URL REDACTED]${trailing}`;
    } catch {
      return '[URL REDACTED]';
    }
  });
}

/**
 * @param {unknown} value
 * @param {{ secrets?: string[], maxLength?: number }} [options]
 */
export function sanitizeFfmpegDiagnostic(value, { secrets = [], maxLength = 500 } = {}) {
  let safe = String(value ?? '');
  const uniqueSecrets = [...new Set(secrets.filter((secret) => typeof secret === 'string' && secret.length > 0))]
    .sort((left, right) => right.length - left.length);
  for (const secret of uniqueSecrets) {
    safe = safe.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
  }
  safe = redactUrls(safe)
    .replace(/(X-Amz-(?:Credential|Signature|Security-Token|Algorithm|Date|Expires|SignedHeaders))=[^&\s"']+/gi, '$1=[REDACTED]')
    .replace(/(Authorization:\s*(?:Bearer|Basic)\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return safe.slice(0, maxLength);
}

/**
 * @param {unknown} error
 * @param {{ secrets?: string[], maxLength?: number }} [options]
 */
export function sanitizeChildProcessError(error, options = {}) {
  if (!error || typeof error !== 'object') {
    return sanitizeFfmpegDiagnostic(error, options);
  }

  const code = typeof error.code === 'string' && /^[A-Z0-9_-]{1,40}$/i.test(error.code)
    ? error.code
    : 'UNKNOWN';
  const syscall = typeof error.syscall === 'string' && /^[a-z0-9_-]{1,40}$/i.test(error.syscall)
    ? error.syscall
    : null;
  const message = sanitizeFfmpegDiagnostic(error.message || 'Child process error.', options);
  // Deliberately never inspect `spawnargs`, `path`, or the full Error object.
  return `FFmpeg child process error (code=${code}${syscall ? `, syscall=${syscall}` : ''}): ${message}`;
}

const DIAGNOSTIC_PATTERN = /\b(error|failed|failure|denied|refused|invalid|unable|no such|timed? out|timeout|http error|could not|broken pipe|connection|401|403|404|5\d\d)\b/i;

/**
 * @param {unknown} stderr
 * @param {{ secrets?: string[], limit?: number, maxLineLength?: number }} [options]
 */
export function extractFfmpegErrorLines(stderr, { secrets = [], limit = 12, maxLineLength = 400 } = {}) {
  return String(stderr ?? '')
    .split(/[\r\n]+/)
    .map((line) => sanitizeFfmpegDiagnostic(line, { secrets, maxLength: maxLineLength }))
    .filter((line) => line && DIAGNOSTIC_PATTERN.test(line))
    .slice(-limit);
}
