import { createProblem } from '../problems/index.js';

const SERIALIZATION_FAILURE = '40001';
const SERIALIZATION_MESSAGE = 'could not serialize access';

function hasCode40001(error: unknown): boolean {
  return (
    error !== null &&
    error !== undefined &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: unknown }).code === SERIALIZATION_FAILURE
  );
}

/**
 * Detect Postgres serialization failures (SQLSTATE 40001).
 *
 * Drizzle and OTel instrumentation may wrap the original pg DatabaseError,
 * so we walk the cause chain and also check the error message as a fallback.
 */
export function isSerializationFailure(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (hasCode40001(current)) return true;
    if (current.message.includes(SERIALIZATION_MESSAGE)) return true;
    current = current.cause;
  }
  return false;
}

export interface SerializationRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, maxRetries: number) => void;
}

export async function withSerializationRetry<T>(
  fn: () => Promise<T>,
  options: SerializationRetryOptions = {},
): Promise<T> {
  const { maxRetries = 5, baseDelayMs = 50, onRetry } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isSerializationFailure(error)) {
        throw error;
      }
      if (attempt + 1 < maxRetries) {
        onRetry?.(attempt + 1, maxRetries);
        // Jittered exponential backoff: base * 2^attempt * random(0.5, 1.5)
        const delay =
          baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random());
        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
      }
    }
  }

  throw createProblem(
    'serialization-exhausted',
    `Operation failed after ${maxRetries} attempts due to concurrent ` +
      'request conflicts. Please retry after a short delay.',
  );
}
