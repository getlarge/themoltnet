import {
  createMetricCounter,
  createMetricHistogram,
} from '@moltnet/observability';

/**
 * Which proxy performed the exchange. Low cardinality by construction — add a
 * value here rather than passing a free-form string.
 */
export type TokenExchangeSource = 'mcp-proxy' | 'rest-proxy';

export type TokenExchangeCacheResult = 'hit' | 'miss' | 'single_flight';

export type TokenExchangeOutcome =
  | 'invalid'
  | 'rate_limited'
  | 'success'
  | 'unavailable';

/**
 * Observability for OAuth2 token acquisition.
 *
 * Every upstream exchange is a billed Ory M2M token, so `recordExchange` is
 * effectively a running total of the invoice — see issue #1860, where the
 * spend could only be attributed from the monthly bill because this path had
 * no instrumentation at all while the (unbilled) validation path was fully
 * instrumented.
 */
export interface TokenExchangeMetrics {
  recordCacheAccess(
    source: string,
    result: TokenExchangeCacheResult,
  ): void;
  /** Called only when an upstream request actually happened. */
  recordExchange(
    source: string,
    grantType: string,
    outcome: TokenExchangeOutcome,
  ): void;
  /** Seconds of usable lifetime left on a token served from cache. */
  recordServedTtl(source: string, seconds: number): void;
}

export const NOOP_TOKEN_EXCHANGE_METRICS: TokenExchangeMetrics = {
  recordCacheAccess: () => undefined,
  recordExchange: () => undefined,
  recordServedTtl: () => undefined,
};

/**
 * Wire the interface to OpenTelemetry instruments. Naming mirrors
 * `auth.remote.*` in @moltnet/auth so both halves of the credential lifecycle
 * — acquisition here, validation there — read as one family.
 */
export function createTokenExchangeMetrics(): TokenExchangeMetrics {
  const cacheAccesses = createMetricCounter(
    '@moltnet/oauth-token-cache',
    'auth.token.cache.accesses',
    'Token cache accesses by result',
  );
  const exchanges = createMetricCounter(
    '@moltnet/oauth-token-cache',
    'auth.token.issued',
    'Upstream OAuth2 token requests (each one is a billed M2M token)',
  );
  const servedTtl = createMetricHistogram(
    '@moltnet/oauth-token-cache',
    'auth.token.remaining_ttl',
    'Usable lifetime remaining on a cache-served token',
    's',
  );

  return {
    recordCacheAccess(source, result) {
      cacheAccesses.add(1, { source, result });
    },
    recordExchange(source, grantType, outcome) {
      exchanges.add(1, { source, grant_type: grantType, outcome });
    },
    recordServedTtl(source, seconds) {
      servedTtl.record(seconds, { source });
    },
  };
}
