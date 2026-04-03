/* eslint-disable no-console */

/**
 * Retry an async function with exponential backoff + jitter.
 *
 * @param {() => Promise<T>} fn - Async callable to retry (no arguments)
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts] - Max attempts (default: JUDGE_MAX_RETRIES env var or 3)
 * @param {number} [opts.baseDelayMs] - Base delay in ms (default: 2000)
 * @param {number} [opts.maxDelayMs] - Max delay cap in ms (default: 15000)
 * @param {(err: Error) => boolean} [opts.shouldRetry] - Return false to abort immediately (default: always retry)
 * @returns {Promise<T>}
 * @template T
 */
export async function withRetry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? parseInt(process.env.JUDGE_MAX_RETRIES ?? '3', 10);
  const baseDelayMs = opts.baseDelayMs ?? 2000;
  const maxDelayMs = opts.maxDelayMs ?? 15000;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!shouldRetry(err)) {
        throw err;
      }
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        const jitter = Math.random() * 0.5 * delay;
        const wait = Math.round(delay + jitter);
        console.error(
          `[retry] attempt ${attempt + 1}/${maxAttempts} failed: ${err.message ?? err}. Retrying in ${wait}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
  console.error(`[retry] all ${maxAttempts} attempts failed`);
  throw lastErr;
}
