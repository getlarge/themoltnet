/**
 * Access-token verification for the MCP endpoint, as an
 * `@modelcontextprotocol/server` `OAuthTokenVerifier`.
 *
 * Matches what `@getlarge/fastify-mcp` did: verify the Hydra JWT against the
 * JWKS (RS256/ES256), and fall back to Hydra introspection when JWT
 * verification fails or no JWKS is configured. Issuer and audience are not
 * checked here, as before; the REST API re-validates every token it receives.
 */
import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import {
  createRemoteJWKSet,
  type JWTPayload,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';

const JWT_ALGORITHMS = ['RS256', 'ES256'];
const JWKS_CACHE_MAX_AGE_MS = 600_000;

export interface HydraTokenVerifierOptions {
  /** Hydra JWKS URL. Omit to rely on introspection only. */
  jwksUri?: string;
  /** Key resolver override (tests); takes precedence over `jwksUri`. */
  keySet?: JWTVerifyGetKey;
  /** Hydra admin introspection endpoint and the bearer credential for it. */
  introspection?: { endpoint: string; bearerToken: string };
  /** Called when JWT verification fails before falling back. */
  onJwtFailure?: (error: unknown) => void;
  fetch?: typeof fetch;
}

/** Claims the MCP server reads from a verified token. */
export interface HydraTokenClaims {
  sub?: string;
  client_id?: string;
  scope?: string;
  scp?: string[];
  exp?: number;
  ext?: Record<string, unknown>;
}

function scopesOf(claims: HydraTokenClaims): string[] {
  if (typeof claims.scope === 'string') {
    return claims.scope.split(' ').filter(Boolean);
  }
  return Array.isArray(claims.scp)
    ? claims.scp.filter((scope) => typeof scope === 'string')
    : [];
}

function toAuthInfo(token: string, claims: HydraTokenClaims): AuthInfo {
  return {
    token,
    clientId: claims.client_id ?? claims.sub ?? '',
    scopes: scopesOf(claims),
    ...(typeof claims.exp === 'number' ? { expiresAt: claims.exp } : {}),
    extra: { sub: claims.sub, ext: claims.ext },
  };
}

function invalidToken(message: string): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, message);
}

export function createHydraTokenVerifier(
  options: HydraTokenVerifierOptions,
): OAuthTokenVerifier {
  const fetchImpl = options.fetch ?? fetch;
  const keySet =
    options.keySet ??
    (options.jwksUri
      ? createRemoteJWKSet(new URL(options.jwksUri), {
          cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
        })
      : undefined);

  async function introspect(
    token: string,
    { endpoint, bearerToken }: { endpoint: string; bearerToken: string },
  ): Promise<HydraTokenClaims> {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: `Bearer ${bearerToken}`,
        },
        body: new URLSearchParams({
          token,
          token_type_hint: 'access_token',
        }),
      });
    } catch {
      throw new OAuthError(OAuthErrorCode.ServerError, 'Introspection failed');
    }
    if (!response.ok) {
      throw invalidToken(`Introspection failed with status ${response.status}`);
    }
    const result = (await response.json()) as HydraTokenClaims & {
      active?: boolean;
    };
    if (!result.active) throw invalidToken('Token is not active');
    return result;
  }

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (keySet) {
        try {
          const { payload } = await jwtVerify(token, keySet, {
            algorithms: JWT_ALGORITHMS,
          });
          return toAuthInfo(token, payload as JWTPayload & HydraTokenClaims);
        } catch (error) {
          options.onJwtFailure?.(error);
        }
      }
      if (options.introspection) {
        return toAuthInfo(
          token,
          await introspect(token, options.introspection),
        );
      }
      throw invalidToken('Token validation failed');
    },
  };
}
