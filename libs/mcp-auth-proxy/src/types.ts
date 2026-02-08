import type { TokenCache } from './cache/types.js';

export interface McpAuthProxyOptions {
  /** Full URL of the OAuth2 token endpoint. Mutually exclusive with oidcDiscoveryUrl. */
  tokenEndpoint?: string;
  /** OIDC discovery URL (e.g. https://hydra/.well-known/openid-configuration). Mutually exclusive with tokenEndpoint. */
  oidcDiscoveryUrl?: string;
  /** OAuth2 scopes to request */
  scopes: string[];
  /** OAuth2 audience parameter (optional, Hydra-specific) */
  audience?: string;
  /** Seconds to subtract from token expiry for early refresh (default: 30) */
  expiryBufferSeconds?: number;
  /** Custom cache implementation (default: MemoryTokenCache) */
  cache?: TokenCache;
  /** Header names for client credentials */
  clientHeaderNames?: {
    clientId?: string;
    clientSecret?: string;
  };
  /** Rate limiting for failed token exchanges */
  rateLimit?: {
    /** Max failures before cooldown (default: 5) */
    maxFailures?: number;
    /** Cooldown duration in ms (default: 60000) */
    cooldownMs?: number;
  };
}
