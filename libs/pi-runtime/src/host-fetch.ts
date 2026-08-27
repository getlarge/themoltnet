import { abortableResource } from '@themoltnet/sandbox-gondolin';

export const DEFAULT_FIXED_ORIGIN_HOST_FETCH_TIMEOUT_MS = 30_000;
export const DEFAULT_FIXED_ORIGIN_HOST_FETCH_MAX_RESPONSE_BYTES = 1024 * 1024;
export const MIN_LITERAL_SECRET_LENGTH = 8;

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type FixedOriginHostFetchErrorCode =
  | 'cancelled'
  | 'invalid_origin'
  | 'invalid_path'
  | 'invalid_response_headers'
  | 'invalid_response_limit'
  | 'invalid_timeout'
  | 'network_failure'
  | 'redirect_rejected'
  | 'response_too_large'
  | 'timeout';

const ERROR_MESSAGES: Readonly<Record<FixedOriginHostFetchErrorCode, string>> =
  Object.freeze({
    cancelled: 'Fixed-origin host request cancelled',
    invalid_origin: 'Fixed-origin host fetch requires an HTTP(S) origin',
    invalid_path: 'Fixed-origin host fetch requires an origin-relative path',
    invalid_response_headers:
      'Fixed-origin host fetch response header selection is invalid',
    invalid_response_limit: 'Fixed-origin host fetch response limit is invalid',
    invalid_timeout: 'Fixed-origin host fetch timeout is invalid',
    network_failure: 'Fixed-origin host request failed',
    redirect_rejected: 'Fixed-origin host request rejected a redirect',
    response_too_large: 'Fixed-origin host response exceeded the size limit',
    timeout: 'Fixed-origin host request timed out',
  });

export type FixedOriginHostFetchNetworkFailureKind =
  | 'connection_refused'
  | 'connection_reset'
  | 'dns'
  | 'tls'
  | 'unknown';

export interface FixedOriginHostFetchErrorDetails {
  readonly networkFailureKind?: FixedOriginHostFetchNetworkFailureKind;
  readonly responseLimit?: number;
  readonly responseLimitSource?: 'declared' | 'streamed';
}

export class FixedOriginHostFetchError extends Error {
  readonly retryable = false;

  constructor(
    public readonly code: FixedOriginHostFetchErrorCode,
    public readonly details: FixedOriginHostFetchErrorDetails = {},
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'FixedOriginHostFetchError';
  }
}

export interface FixedOriginHostFetchOptions {
  /** Scheme and authority only, for example https://api.example.com. */
  readonly origin: string | URL;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  /** Response headers exposed to the caller. Credential/framing headers are forbidden. */
  readonly responseHeaders?: readonly string[];
}

export interface FixedOriginHostFetchRequestInit extends Omit<
  RequestInit,
  'redirect' | 'signal'
> {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export type FixedOriginHostFetch = (
  path: string,
  init?: FixedOriginHostFetchRequestInit,
) => Promise<Response>;

/**
 * Build a bounded host-side HTTP client whose caller can select only a path on
 * one configured origin. This does not enforce private-address or DNS policy.
 */
export function createFixedOriginHostFetch(
  options: FixedOriginHostFetchOptions,
): FixedOriginHostFetch {
  const origin = normalizeOrigin(options.origin);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const defaultTimeoutMs = validateTimeout(
    options.timeoutMs ?? DEFAULT_FIXED_ORIGIN_HOST_FETCH_TIMEOUT_MS,
  );
  const defaultMaxResponseBytes = validateResponseLimit(
    options.maxResponseBytes ??
      DEFAULT_FIXED_ORIGIN_HOST_FETCH_MAX_RESPONSE_BYTES,
  );
  const responseHeaders = canonicalizeResponseHeaderNames(
    options.responseHeaders ?? [],
  );

  return async (path, init = {}) => {
    const {
      maxResponseBytes: requestMaxResponseBytes,
      signal: requestSignal,
      timeoutMs: requestTimeoutMs,
      ...requestInit
    } = init;
    const url = resolveRelativePath(origin, path);
    const timeoutMs = Math.min(
      validateTimeout(requestTimeoutMs ?? defaultTimeoutMs),
      defaultTimeoutMs,
    );
    const maxResponseBytes = Math.min(
      validateResponseLimit(requestMaxResponseBytes ?? defaultMaxResponseBytes),
      defaultMaxResponseBytes,
    );
    if (requestSignal?.aborted) {
      throw new FixedOriginHostFetchError('cancelled');
    }

    const controller = new AbortController();
    let timedOut = false;
    const onCancel = () => controller.abort();
    requestSignal?.addEventListener('abort', onCancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await abortableResource({
        promise: fetchImpl(url, {
          ...requestInit,
          redirect: 'manual',
          signal: controller.signal,
        }),
        signal: controller.signal,
        label: 'fixed-origin host fetch',
        cleanup: cancelResponse,
      });
      if (
        isRedirectResponse(response) ||
        !hasExpectedOrigin(response, origin)
      ) {
        void cancelResponse(response);
        throw new FixedOriginHostFetchError('redirect_rejected');
      }
      validateResponseStatus(response.status);
      const body = await readBoundedResponse(
        response,
        maxResponseBytes,
        controller.signal,
      );
      const headers = selectResponseHeaders(response.headers, responseHeaders);
      const responseBody = isNullBodyStatus(response.status)
        ? null
        : body.byteLength === 0
          ? null
          : body;
      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      if (error instanceof FixedOriginHostFetchError) throw error;
      if (timedOut) throw new FixedOriginHostFetchError('timeout');
      if (requestSignal?.aborted) {
        throw new FixedOriginHostFetchError('cancelled');
      }
      throw new FixedOriginHostFetchError('network_failure', {
        networkFailureKind: classifyNetworkFailure(error),
      });
    } finally {
      clearTimeout(timer);
      requestSignal?.removeEventListener('abort', onCancel);
    }
  };
}

/**
 * Replace exact literal secret values of at least eight characters.
 * Encoded, transformed, or case-shifted representations are intentionally not
 * inferred; callers must redact those representations before projection.
 */
export function redactLiteralSecrets(
  value: string,
  secrets: readonly (string | null | undefined)[],
  replacement = '[REDACTED]',
): string {
  const ordered = [
    ...new Set(
      secrets.filter(
        (secret): secret is string =>
          typeof secret === 'string' &&
          secret.length >= MIN_LITERAL_SECRET_LENGTH,
      ),
    ),
  ].sort((left, right) => right.length - left.length);
  return ordered.reduce(
    (redacted, secret) => redacted.replaceAll(secret, replacement),
    value,
  );
}

function normalizeOrigin(value: string | URL): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FixedOriginHostFetchError('invalid_origin');
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new FixedOriginHostFetchError('invalid_origin');
  }
  return parsed.origin;
}

function resolveRelativePath(origin: string, path: string): URL {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    path.includes('#')
  ) {
    throw new FixedOriginHostFetchError('invalid_path');
  }
  let resolved: URL;
  try {
    resolved = new URL(path, `${origin}/`);
  } catch {
    throw new FixedOriginHostFetchError('invalid_path');
  }
  if (resolved.origin !== origin) {
    throw new FixedOriginHostFetchError('invalid_path');
  }
  return resolved;
}

function validateTimeout(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new FixedOriginHostFetchError('invalid_timeout');
  }
  return value;
}

function validateResponseLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FixedOriginHostFetchError('invalid_response_limit');
  }
  return value;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
const FORBIDDEN_RESPONSE_HEADERS = new Set([
  'authentication-info',
  'authorization',
  'content-encoding',
  'content-length',
  'cookie',
  'proxy-authenticate',
  'proxy-authentication-info',
  'proxy-authorization',
  'set-cookie',
  'set-cookie2',
  'transfer-encoding',
  'www-authenticate',
]);

function canonicalizeResponseHeaderNames(
  values: readonly string[],
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') {
      throw new FixedOriginHostFetchError('invalid_response_headers');
    }
    const name = value.toLowerCase();
    try {
      new Headers([[name, 'validate']]);
    } catch {
      throw new FixedOriginHostFetchError('invalid_response_headers');
    }
    if (FORBIDDEN_RESPONSE_HEADERS.has(name)) {
      throw new FixedOriginHostFetchError('invalid_response_headers');
    }
    names.add(name);
  }
  return names;
}

function selectResponseHeaders(
  source: Headers,
  allowedNames: ReadonlySet<string>,
): Headers {
  const selected = new Headers();
  for (const name of allowedNames) {
    const value = source.get(name);
    if (value !== null) selected.set(name, value);
  }
  return selected;
}

function isRedirectResponse(response: Response): boolean {
  return (
    response.redirected ||
    (REDIRECT_STATUSES.has(response.status) && response.headers.has('location'))
  );
}

function hasExpectedOrigin(response: Response, origin: string): boolean {
  if (response.url === '') return true;
  try {
    return new URL(response.url).origin === origin;
  } catch {
    return false;
  }
}

function validateResponseStatus(status: number): void {
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new FixedOriginHostFetchError('network_failure', {
      networkFailureKind: 'unknown',
    });
  }
}

function isNullBodyStatus(status: number): boolean {
  return NULL_BODY_STATUSES.has(status);
}

function cancelResponse(response: Response): Promise<void> | void {
  try {
    return response.body?.cancel().catch(() => undefined);
  } catch {
    // A response body that is already locked may reject cancellation.
  }
}

function classifyNetworkFailure(
  error: unknown,
): FixedOriginHostFetchNetworkFailureKind {
  const code = readNetworkErrorCode(error);
  if (code === 'ECONNREFUSED') return 'connection_refused';
  if (code === 'ECONNRESET' || code === 'EPIPE') return 'connection_reset';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  ) {
    return 'tls';
  }
  return 'unknown';
}

function readNetworkErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { cause?: unknown; code?: unknown };
  if (typeof record.code === 'string') return record.code;
  if (record.cause === error) return undefined;
  return readNetworkErrorCode(record.cause);
}

async function readBoundedResponse(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    void cancelResponse(response);
    throw new FixedOriginHostFetchError('response_too_large', {
      responseLimit: limit,
      responseLimitSource: 'declared',
    });
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = createAbortWaiter(signal);
  let pendingRead: ReturnType<typeof reader.read> | undefined;
  try {
    while (true) {
      pendingRead = reader.read();
      const { done, value } = await Promise.race([pendingRead, abort.promise]);
      pendingRead = undefined;
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => undefined);
        throw new FixedOriginHostFetchError('response_too_large', {
          responseLimit: limit,
          responseLimitSource: 'streamed',
        });
      }
      chunks.push(value);
    }
  } finally {
    abort.dispose();
    if (signal.aborted) {
      const cancellation = reader.cancel().catch(() => undefined);
      void Promise.allSettled(
        pendingRead ? [pendingRead, cancellation] : [cancellation],
      ).then(() => releaseReaderLock(reader));
    } else {
      releaseReaderLock(reader);
    }
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function createAbortWaiter(signal: AbortSignal): {
  promise: Promise<never>;
  dispose(): void;
} {
  const abortError = new Error('Fixed-origin host request aborted');
  let rejectAbort: (error: Error) => void = () => undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort(abortError);
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  return {
    promise,
    dispose: () => signal.removeEventListener('abort', onAbort),
  };
}

function releaseReaderLock(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  try {
    reader.releaseLock();
  } catch {
    // A hostile/injected stream may retain a pending read after cancellation.
  }
}
