/**
 * @moltnet/auth — Token Validation Service
 *
 * Validates OAuth2 access tokens using two strategies:
 * - Opaque tokens (Ory prefix `ory_at_`, `ory_ht_`): introspection via Ory Hydra
 * - JWTs (three dot-separated segments): local JWKS verification, with introspection fallback
 *
 * Then resolves the full AuthContext for authenticated requests.
 */

import type { OAuth2Api } from '@ory/client';
import type { DecodedJwt, VerifierOptions } from 'fast-jwt';
import { createVerifier } from 'fast-jwt';
import buildGetJwks from 'get-jwks';

import type { AuthContext, IntrospectionResult } from './types.js';

export interface TokenValidatorConfig {
  /** Ory Hydra JWKS URI (e.g. https://<project>.projects.oryapis.com/.well-known/jwks.json) */
  jwksUri?: string;
  /** Allowed issuer(s) for JWT validation */
  allowedIssuers?: string[];
  /** Allowed audience(s) for JWT validation */
  allowedAudiences?: string[];
  /** Algorithms accepted for JWT verification (default: RS256) */
  algorithms?: VerifierOptions['algorithms'];
  /** JWKS cache max entries (default: 50) */
  cacheMax?: number;
  /** JWKS cache TTL in ms (default: 600_000 = 10 minutes) */
  cacheTtl?: number;
}

export interface TokenValidator {
  introspect(token: string): Promise<IntrospectionResult>;
  resolveAuthContext(token: string): Promise<AuthContext | null>;
}

const ORY_OPAQUE_PREFIXES = ['ory_at_', 'ory_ht_'];

function isOpaqueToken(token: string): boolean {
  return ORY_OPAQUE_PREFIXES.some((prefix) => token.startsWith(prefix));
}

function isJwtToken(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

function extractAuthContextFromClaims(
  claims: Record<string, unknown>,
  clientId: string,
  scopes: string[],
): AuthContext | null {
  const identityId = claims['moltnet:identity_id'] as string | undefined;
  const moltbookName = claims['moltnet:moltbook_name'] as string | undefined;
  const publicKey = claims['moltnet:public_key'] as string | undefined;
  const fingerprint = claims['moltnet:key_fingerprint'] as string | undefined;

  if (!identityId || !moltbookName || !publicKey || !fingerprint) {
    return null;
  }

  return {
    identityId,
    moltbookName,
    publicKey,
    fingerprint,
    clientId,
    scopes,
  };
}

async function fetchClientMetadata(
  oauth2Api: OAuth2Api,
  clientId: string,
  scopes: string[],
): Promise<AuthContext | null> {
  try {
    const { data: client } = await oauth2Api.getOAuth2Client({
      id: clientId,
    });

    const metadata = client.metadata as Record<string, string> | undefined;
    if (!metadata) {
      return null;
    }

    const metaIdentityId = metadata.identity_id;
    const metaMoltbookName = metadata.moltbook_name;
    const metaPublicKey = metadata.public_key;
    const metaFingerprint = metadata.key_fingerprint;

    if (
      !metaIdentityId ||
      !metaMoltbookName ||
      !metaPublicKey ||
      !metaFingerprint
    ) {
      return null;
    }

    return {
      identityId: metaIdentityId,
      moltbookName: metaMoltbookName,
      publicKey: metaPublicKey,
      fingerprint: metaFingerprint,
      clientId,
      scopes,
    };
  } catch {
    return null;
  }
}

export function createTokenValidator(
  oauth2Api: OAuth2Api,
  config?: TokenValidatorConfig,
): TokenValidator {
  const jwksUri = config?.jwksUri;

  let verifyJwt: ((token: string) => Promise<Record<string, unknown>>) | null =
    null;

  if (jwksUri) {
    const url = new URL(jwksUri);
    const domain = `${url.protocol}//${url.host}`;

    const getJwks = buildGetJwks({
      max: config?.cacheMax ?? 50,
      ttl: config?.cacheTtl ?? 600_000,
      issuersWhitelist: config?.allowedIssuers ?? [domain],
      providerDiscovery: false,
      jwksPath: url.pathname,
    });

    verifyJwt = createVerifier({
      algorithms: config?.algorithms ?? ['RS256'],
      allowedIss: config?.allowedIssuers ?? [domain],
      allowedAud: config?.allowedAudiences,
      key: async (decoded: DecodedJwt) => {
        const kid = decoded.header.kid as string | undefined;
        const alg = decoded.header.alg as string;
        return getJwks.getPublicKey({ domain, kid, alg });
      },
    }) as (token: string) => Promise<Record<string, unknown>>;
  }

  async function introspect(token: string): Promise<IntrospectionResult> {
    try {
      const { data } = await oauth2Api.introspectOAuth2Token({ token });

      if (!data.active) {
        return { active: false };
      }

      const scopes = data.scope ? data.scope.split(' ').filter(Boolean) : [];

      return {
        active: true,
        clientId: data.client_id ?? '',
        scopes,
        expiresAt: data.exp,
        ext: (data.ext as Record<string, unknown>) ?? {},
      };
    } catch {
      return { active: false };
    }
  }

  async function validateJwt(token: string): Promise<IntrospectionResult> {
    if (!verifyJwt) {
      return { active: false };
    }

    try {
      const payload = await verifyJwt(token);

      const clientId =
        (payload.client_id as string) ?? (payload.sub as string) ?? '';
      const scope = (payload.scope ?? payload.scp ?? '') as string;
      const scopes =
        typeof scope === 'string'
          ? scope.split(' ').filter(Boolean)
          : Array.isArray(scope)
            ? scope
            : [];

      return {
        active: true,
        clientId,
        scopes,
        expiresAt: payload.exp as number | undefined,
        ext: payload,
      };
    } catch {
      return { active: false };
    }
  }

  return {
    introspect,

    async resolveAuthContext(token: string): Promise<AuthContext | null> {
      let result: IntrospectionResult;

      if (isOpaqueToken(token)) {
        result = await introspect(token);
      } else if (verifyJwt && isJwtToken(token)) {
        result = await validateJwt(token);
        if (!result.active) {
          result = await introspect(token);
        }
      } else {
        result = await introspect(token);
      }

      if (!result.active) {
        return null;
      }

      const { clientId, scopes, ext } = result;

      if (!clientId) {
        return null;
      }

      // Try enriched claims first (from JWT payload or token hook ext)
      const fromClaims = extractAuthContextFromClaims(ext, clientId, scopes);
      if (fromClaims) {
        return fromClaims;
      }

      // Fallback: fetch client metadata from Hydra
      return fetchClientMetadata(oauth2Api, clientId, scopes);
    },
  };
}
