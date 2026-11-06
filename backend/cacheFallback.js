const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Retry local cache preparation without exposing signed-source errors. */
export async function retryCachePreparation({
  attempts = 2,
  prepare,
  shouldAbort = () => false,
  waitBeforeRetry = wait,
}) {
  let lastError = null;
  let completedAttempts = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (shouldAbort()) return { value: null, lastError, attempts: completedAttempts, cancelled: true };
    completedAttempts = attempt;
    try {
      const value = await prepare(attempt);
      if (value) return { value, lastError: null, attempts: completedAttempts, cancelled: false };
      lastError = new Error('Local video cache preparation returned no entry.');
    } catch (error) {
      lastError = error;
    }
    if (shouldAbort()) return { value: null, lastError, attempts: completedAttempts, cancelled: true };
    if (attempt < attempts) await waitBeforeRetry(attempt * 500);
  }
  return { value: null, lastError, attempts: completedAttempts, cancelled: shouldAbort() };
}

export function getCacheFallbackReason(sourceVersionKnown) {
  return sourceVersionKnown ? 'local-cache-unavailable' : 'source-version-unavailable';
}
