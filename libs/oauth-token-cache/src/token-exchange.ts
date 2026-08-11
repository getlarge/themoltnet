import { createHash } from 'node:crypto';

import type { CachedToken, TokenCache } from './cache/types.js';
import {
  NOOP_TOKEN_EXCHANGE_METRICS,
  type TokenExchangeMetrics,
} from './metrics.js';

/** The only grant this exchanger performs; kept explicit for metric tagging. */
const GRANT_TYPE = 'client_credentials';

/**
 * Minimal structural logger. Kept local rather than importing Fastify's so this
 * package stays framework-agnostic — `FastifyBaseLogger` satisfies it, as does
 * a bare Pino instance or a test double.
 */
export interface TokenExchangeLogger {
  debug(obj: unknown, msg?: string): void;
}

function credentialKey(clientId: string, clientSecret: string): string {
  const hash = createHash('sha256').update(clientSecret).digest('hex');
  return `${clientId}:${hash}`;
}

interface TokenExchangeError extends Error {
  statusCode: number;
  code: string;
  detail: string;
}

function createError(
  statusCode: number,
  code: string,
  message: string,
): TokenExchangeError {
  const error = new Error(message) as TokenExchangeError;
  error.statusCode = statusCode;
  error.code = code;
  error.detail = message;
  return error;
}

export async function discoverTokenEndpoint(
  oidcDiscoveryUrl: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(oidcDiscoveryUrl, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    throw new Error(
      `OIDC discovery failed for ${oidcDiscoveryUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `OIDC discovery returned HTTP ${response.status} for ${oidcDiscoveryUrl}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `OIDC discovery returned invalid JSON for ${oidcDiscoveryUrl}`,
    );
  }

  const tokenEndpoint = (body as Record<string, unknown>)?.token_endpoint;
  if (typeof tokenEndpoint !== 'string' || !tokenEndpoint) {
    throw new Error(
      `OIDC discovery response missing token_endpoint for ${oidcDiscoveryUrl}`,
    );
  }

  return tokenEndpoint;
}

export interface TokenExchangerConfig {
  tokenEndpoint: string;
  scopes: string[];
  audience?: string;
  expiryBufferSeconds: number;
  cache: TokenCache;
  rateLimit: {
    maxFailures: number;
    cooldownMs: number;
  };
  log: TokenExchangeLogger;
  /** Optional. Defaults to a no-op so callers can opt out of instrumentation. */
  metrics?: TokenExchangeMetrics;
  /** Tags every metric so callers stay distinguishable. */
  source?: string;
}

interface FailureEntry {
  failures: number;
  cooldownUntil: number;
}

export interface TokenExchanger {
  exchange(clientId: string, clientSecret: string): Promise<string>;
  close(): void;
}

export function createTokenExchanger(
  config: TokenExchangerConfig,
): TokenExchanger {
  const inFlight = new Map<string, Promise<CachedToken>>();
  const failureTracker = new Map<string, FailureEntry>();
  const metrics = config.metrics ?? NOOP_TOKEN_EXCHANGE_METRICS;
  const source = config.source ?? 'unknown';

  function checkRateLimit(clientId: string): void {
    const entry = failureTracker.get(clientId);
    if (!entry) return;
    if (
      entry.failures >= config.rateLimit.maxFailures &&
      Date.now() < entry.cooldownUntil
    ) {
      throw createError(
        429,
        'RATE_LIMITED',
        `Too many failed token exchanges for client ${clientId}`,
      );
    }
  }

  function recordFailure(clientId: string): void {
    const entry = failureTracker.get(clientId) ?? {
      failures: 0,
      cooldownUntil: 0,
    };
    entry.failures += 1;
    if (entry.failures >= config.rateLimit.maxFailures) {
      entry.cooldownUntil = Date.now() + config.rateLimit.cooldownMs;
    }
    failureTracker.set(clientId, entry);
  }

  function resetFailures(clientId: string): void {
    failureTracker.delete(clientId);
  }

  async function doExchange(
    clientId: string,
    clientSecret: string,
  ): Promise<CachedToken> {
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: config.scopes.join(' '),
    });
    if (config.audience) {
      params.set('audience', config.audience);
    }

    let response: Response;
    try {
      response = await fetch(config.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      recordFailure(clientId);
      metrics.recordExchange(source, GRANT_TYPE, 'unavailable');
      throw createError(
        502,
        'BAD_GATEWAY',
        `Token endpoint unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      recordFailure(clientId);
      if (response.status === 400 || response.status === 401) {
        metrics.recordExchange(source, GRANT_TYPE, 'invalid');
        throw createError(
          401,
          'UNAUTHORIZED',
          `Token endpoint rejected credentials (HTTP ${response.status})`,
        );
      }
      metrics.recordExchange(source, GRANT_TYPE, 'unavailable');
      throw createError(
        502,
        'BAD_GATEWAY',
        `Token endpoint returned HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    const expiresAt =
      Date.now() + body.expires_in * 1_000 - config.expiryBufferSeconds * 1_000;

    const cached: CachedToken = { token: body.access_token, expiresAt };
    const cacheKey = credentialKey(clientId, clientSecret);
    await config.cache.set(cacheKey, cached);
    resetFailures(clientId);
    metrics.recordExchange(source, GRANT_TYPE, 'success');

    config.log.debug(
      { clientId, expiresIn: body.expires_in },
      'Token exchanged successfully',
    );

    return cached;
  }

  async function exchange(
    clientId: string,
    clientSecret: string,
  ): Promise<string> {
    checkRateLimit(clientId);

    const key = credentialKey(clientId, clientSecret);

    const cached = await config.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      metrics.recordCacheAccess(source, 'hit');
      metrics.recordServedTtl(
        source,
        Math.round((cached.expiresAt - Date.now()) / 1000),
      );
      return cached.token;
    }

    const existing = inFlight.get(key);
    if (existing) {
      metrics.recordCacheAccess(source, 'single_flight');
      const result = await existing;
      return result.token;
    }

    metrics.recordCacheAccess(source, 'miss');

    const promise = doExchange(clientId, clientSecret);
    inFlight.set(key, promise);

    try {
      const result = await promise;
      return result.token;
    } finally {
      inFlight.delete(key);
    }
  }

  function close(): void {
    inFlight.clear();
    failureTracker.clear();
  }

  return { exchange, close };
}
