/**
 * @moltnet/auth — Token Validation Service
 *
 * Validates OAuth2 access tokens using two strategies:
 * - Opaque tokens (Ory prefix `ory_at_`, `ory_ht_`): introspection via Ory Hydra
 * - JWTs (three dot-separated segments): local JWKS verification, with
 *   introspection fallback only for transient JWKS failures
 *
 * Then resolves the full AuthContext for authenticated requests.
 */

import {
  type ApiKeysApi,
  KeyStatus,
  KeyVisibility,
  type OAuth2Api,
} from '@ory/client-fetch';
import { createRemoteJWKSet, errors, type JWTPayload, jwtVerify } from 'jose';

import { ORY_OPAQUE_PREFIXES, TALOS_API_KEY_PREFIXES } from './constants.js';
import type {
  AgentAuthContext,
  AuthContext,
  HumanAuthContext,
  IntrospectionResult,
  SubjectType,
} from './types.js';

export interface TokenValidatorConfig {
  /** Ory Hydra JWKS URI (e.g. https://<project>.projects.oryapis.com/.well-known/jwks.json) */
  jwksUri?: string;
  /** Exact issuer allowlist. Empty/omitted uses the JWKS origin. */
  allowedIssuers?: string[];
  /** Exact audience allowlist. Empty/omitted disables audience validation. */
  allowedAudiences?: string[];
  /** JWKS cache TTL in ms (default: 600_000 = 10 minutes) */
  cacheTtl?: number;
  /** Minimum delay between JWKS refreshes in ms (default: 30_000) */
  jwksCooldownMs?: number;
  /** JWKS request timeout in ms (default: 5_000) */
  jwksTimeoutMs?: number;
  /** Optional trusted Talos admin client used only for issued API keys. */
  talosApi?: Pick<ApiKeysApi, 'adminVerifyApiKey'>;
  /** Resolve the verified Talos actor to MoltNet's canonical active agent. */
  resolveTalosAgent?: TalosAgentResolver;
  /** Secret-safe authentication diagnostics. */
  logger?: TokenValidatorLogger;
  /** Low-cardinality validation event sink (for example, an OTel counter). */
  onValidationEvent?: (event: TokenValidationEvent) => void;
}

export interface TalosAgentIdentity {
  identityId: string;
  publicKey: string;
  fingerprint: string;
}

export type TalosAgentResolver = (
  identityId: string,
) => Promise<TalosAgentIdentity | null>;

export interface TokenValidatorLogger {
  debug: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

export type TokenValidationReason =
  | 'algorithm_rejected'
  | 'claim_validation_failed'
  | 'credential_accepted'
  | 'credential_expired'
  | 'credential_inactive'
  | 'introspection_fallback'
  | 'introspection_unavailable'
  | 'jwks_key_not_found'
  | 'jwks_unavailable'
  | 'signature_invalid'
  | 'token_invalid'
  | 'unexpected';

export interface TokenValidationEvent {
  credentialType: 'ory-jwt' | 'ory-opaque' | 'ory-token';
  reason: TokenValidationReason;
}

export interface TokenValidator {
  introspect(token: string): Promise<IntrospectionResult>;
  resolveAuthContext(token: string): Promise<AuthContext | null>;
}

const ORY_JWT_ALGORITHM = 'RS256' as const;
const DEFAULT_JWKS_CACHE_TTL_MS = 600_000;
const DEFAULT_JWKS_COOLDOWN_MS = 30_000;
const DEFAULT_JWKS_TIMEOUT_MS = 5_000;

function isOpaqueToken(token: string): boolean {
  return ORY_OPAQUE_PREFIXES.some((prefix) => token.startsWith(prefix));
}

function isTalosApiKey(token: string): boolean {
  return TALOS_API_KEY_PREFIXES.some((prefix) => token.startsWith(prefix));
}

function asMetadata(value: object | undefined): Record<string, unknown> {
  if (!value || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function summarizeOryError(error: unknown): {
  errorType: string;
  status?: number;
  causeCode?: string;
} {
  if (typeof error !== 'object' || error === null) {
    return { errorType: 'UnknownError' };
  }

  const candidate = error as {
    name?: unknown;
    response?: { status?: unknown };
    cause?: { code?: unknown };
  };
  return {
    errorType:
      typeof candidate.name === 'string' ? candidate.name : 'UnknownError',
    ...(typeof candidate.response?.status === 'number'
      ? { status: candidate.response.status }
      : {}),
    ...(typeof candidate.cause?.code === 'string'
      ? { causeCode: candidate.cause.code }
      : {}),
  };
}

type JwtFailureSummary = {
  errorType: string;
  reason: Extract<
    TokenValidationReason,
    | 'algorithm_rejected'
    | 'claim_validation_failed'
    | 'credential_expired'
    | 'jwks_key_not_found'
    | 'jwks_unavailable'
    | 'signature_invalid'
    | 'token_invalid'
    | 'unexpected'
  >;
  claim?: string;
};

type JwtValidationResult =
  | { failure: JwtFailureSummary; result: IntrospectionResult }
  | { result: IntrospectionResult };

const JWKS_NETWORK_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

function getCauseCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause !== 'object' || cause === null) return undefined;
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function summarizeJwtError(error: unknown): JwtFailureSummary {
  if (error instanceof errors.JWTExpired) {
    return {
      errorType: 'JWTExpired',
      reason: 'credential_expired',
    };
  }
  if (error instanceof errors.JWTClaimValidationFailed) {
    return {
      errorType: 'JWTClaimValidationFailed',
      reason: 'claim_validation_failed',
      ...(typeof error.claim === 'string' ? { claim: error.claim } : {}),
    };
  }
  if (error instanceof errors.JOSEAlgNotAllowed) {
    return {
      errorType: 'JOSEAlgNotAllowed',
      reason: 'algorithm_rejected',
    };
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) {
    return {
      errorType: 'JWSSignatureVerificationFailed',
      reason: 'signature_invalid',
    };
  }
  if (error instanceof errors.JWKSNoMatchingKey) {
    return {
      errorType: 'JWKSNoMatchingKey',
      reason: 'jwks_key_not_found',
    };
  }
  const isTimeout = error instanceof errors.JWKSTimeout;
  const isRemoteJwksResponseError =
    error instanceof errors.JOSEError && error.constructor === errors.JOSEError;
  const causeCode = getCauseCode(error);
  const isNetworkFailure =
    causeCode !== undefined && JWKS_NETWORK_ERROR_CODES.has(causeCode);
  if (
    isTimeout ||
    isRemoteJwksResponseError ||
    isNetworkFailure ||
    error instanceof errors.JWKInvalid ||
    error instanceof errors.JWKSInvalid
  ) {
    return {
      errorType: isTimeout
        ? 'JWKSTimeout'
        : error instanceof Error
          ? error.constructor.name
          : 'UnknownError',
      reason: 'jwks_unavailable',
    };
  }
  if (error instanceof errors.JOSEError) {
    return {
      errorType: error.constructor.name,
      reason: 'token_invalid',
    };
  }
  return {
    errorType:
      typeof error === 'object' &&
      error !== null &&
      typeof error.constructor?.name === 'string'
        ? error.constructor.name
        : 'UnknownError',
    reason: 'unexpected',
  };
}

function isJwtToken(token: string): boolean {
  const firstDot = token.indexOf('.');
  if (firstDot <= 0) return false;
  const secondDot = token.indexOf('.', firstDot + 1);
  return secondDot > firstDot + 1 && token.indexOf('.', secondDot + 1) === -1;
}

function shouldIntrospectJwtFailure(reason: JwtFailureSummary['reason']) {
  return reason === 'jwks_key_not_found' || reason === 'jwks_unavailable';
}

function extractAuthContextFromClaims(
  claims: Record<string, unknown>,
  clientId: string,
  scopes: string[],
): AuthContext | null {
  const identityId = claims['moltnet:identity_id'] as string | undefined;
  const subjectType =
    (claims['moltnet:subject_type'] as SubjectType) ?? 'agent';

  if (!identityId) {
    return null;
  }

  if (subjectType === 'human') {
    const humanId = claims['moltnet:human_id'] as string | undefined;
    if (!humanId) {
      // Token was issued before humans.id was wired into JWT claims, or
      // the token-exchange hook was unable to resolve the humans row.
      // Refuse to surface an authContext rather than handing routes a
      // principal they can't translate into a creator FK.
      return null;
    }
    return {
      subjectType: 'human',
      identityId,
      humanId,
      clientId: clientId || null,
      scopes,
      currentTeamId: null,
    } satisfies HumanAuthContext;
  }

  const publicKey = claims['moltnet:public_key'] as string | undefined;
  const fingerprint = claims['moltnet:fingerprint'] as string | undefined;

  if (!publicKey || !fingerprint) {
    return null;
  }

  return {
    subjectType: 'agent',
    identityId,
    publicKey,
    fingerprint,
    clientId,
    scopes,
    currentTeamId: null,
  } satisfies AgentAuthContext;
}

async function fetchClientMetadata(
  oauth2Api: OAuth2Api,
  clientId: string,
  scopes: string[],
  logger: TokenValidatorLogger,
): Promise<AuthContext | null> {
  try {
    const client = await oauth2Api.getOAuth2Client({
      id: clientId,
    });

    const metadata = client.metadata as Record<string, string> | undefined;
    if (!metadata) {
      return null;
    }

    const metaIdentityId = metadata.identity_id;
    if (!metaIdentityId) {
      return null;
    }

    const metaType = metadata.type;

    if (metaType === 'moltnet_human') {
      const metaHumanId = metadata.human_id;
      if (!metaHumanId) {
        return null;
      }
      return {
        subjectType: 'human',
        identityId: metaIdentityId,
        humanId: metaHumanId,
        clientId: clientId || null,
        scopes,
        currentTeamId: null,
      } satisfies HumanAuthContext;
    }

    const metaPublicKey = metadata.public_key;
    const metaFingerprint = metadata.fingerprint;

    if (!metaPublicKey || !metaFingerprint) {
      return null;
    }

    return {
      subjectType: 'agent',
      identityId: metaIdentityId,
      publicKey: metaPublicKey,
      fingerprint: metaFingerprint,
      clientId,
      scopes,
      currentTeamId: null,
    } satisfies AgentAuthContext;
  } catch (error) {
    logger.warn(
      {
        credentialType: 'ory-client-metadata',
        reason: 'metadata_lookup_unavailable',
        ...summarizeOryError(error),
      },
      'Ory client metadata unavailable',
    );
    return null;
  }
}

export function createTokenValidator(
  oauth2Api: OAuth2Api,
  config?: TokenValidatorConfig,
): TokenValidator {
  const jwksUri = config?.jwksUri;
  const logger = config?.logger ?? {
    debug: () => undefined,
    warn: () => undefined,
  };
  const recordValidationEvent = (event: TokenValidationEvent) => {
    try {
      config?.onValidationEvent?.(event);
    } catch (error) {
      logger.warn(
        {
          credentialType: event.credentialType,
          reason: 'telemetry_recording_failed',
          ...summarizeOryError(error),
        },
        'Token validation telemetry unavailable',
      );
    }
  };

  async function resolveTalosApiKey(
    token: string,
  ): Promise<AgentAuthContext | null> {
    if (!config?.talosApi || !config.resolveTalosAgent) return null;

    let result: Awaited<
      ReturnType<Pick<ApiKeysApi, 'adminVerifyApiKey'>['adminVerifyApiKey']>
    >;
    try {
      result = await config.talosApi.adminVerifyApiKey({
        verifyApiKeyRequest: { credential: token },
        cacheControl: 'no-store',
        pragma: 'no-cache',
      });
    } catch (error) {
      logger.warn(
        {
          credentialType: 'talos-api-key',
          reason: 'verifier_request_failed',
          ...summarizeOryError(error),
        },
        'Talos API key validation unavailable',
      );
      return null;
    }

    const expired = result.expire_time
      ? result.expire_time.getTime() <= Date.now()
      : false;
    const invalidStatus =
      result.status !== undefined &&
      result.status !== KeyStatus.KeyStatusActive &&
      result.status !== KeyStatus.KeyStatusUnspecified;
    const publicVisibility =
      result.visibility === KeyVisibility.KeyVisibilityPublic;
    if (!result.is_valid || expired || invalidStatus || publicVisibility) {
      logger.debug(
        {
          credentialType: 'talos-api-key',
          reason: publicVisibility
            ? 'public_key_rejected'
            : 'credential_rejected',
          errorCode: result.error_code,
          status: result.status,
        },
        'Talos API key rejected',
      );
      return null;
    }
    if (!result.actor_id || !result.key_id) {
      logger.warn(
        {
          credentialType: 'talos-api-key',
          reason: 'incomplete_verification_response',
        },
        'Talos API key validation failed',
      );
      return null;
    }

    const metadata = asMetadata(result.metadata);
    if (metadata.subject_type !== 'agent') {
      logger.warn(
        {
          credentialType: 'talos-api-key',
          reason: 'invalid_subject_type',
          keyId: result.key_id,
          actorId: result.actor_id,
        },
        'Talos API key metadata rejected',
      );
      return null;
    }

    const teamId = metadata.team_id;
    if (teamId !== undefined && typeof teamId !== 'string') {
      logger.warn(
        {
          credentialType: 'talos-api-key',
          reason: 'invalid_team_binding',
          keyId: result.key_id,
          actorId: result.actor_id,
        },
        'Talos API key metadata rejected',
      );
      return null;
    }

    let agent: TalosAgentIdentity | null;
    try {
      agent = await config.resolveTalosAgent(result.actor_id);
    } catch (error) {
      logger.warn(
        {
          credentialType: 'talos-api-key',
          reason: 'agent_resolution_failed',
          actorId: result.actor_id,
          ...summarizeOryError(error),
        },
        'Talos agent resolution unavailable',
      );
      return null;
    }
    if (!agent || agent.identityId !== result.actor_id) {
      logger.warn(
        {
          credentialType: 'talos-api-key',
          reason: 'agent_not_found_or_inactive',
          keyId: result.key_id,
          actorId: result.actor_id,
        },
        'Talos API key actor rejected',
      );
      return null;
    }

    logger.debug(
      {
        credentialType: 'talos-api-key',
        reason: 'credential_accepted',
        keyId: result.key_id,
        actorId: result.actor_id,
        scopeCount: result.scopes?.length ?? 0,
        teamBound: Boolean(teamId),
      },
      'Talos API key accepted',
    );

    return {
      subjectType: 'agent',
      identityId: agent.identityId,
      publicKey: agent.publicKey,
      fingerprint: agent.fingerprint,
      clientId: result.key_id,
      scopes: result.scopes ?? [],
      currentTeamId: null,
      credentialBinding: {
        keyId: result.key_id,
        ...(teamId ? { boundTeamId: teamId } : {}),
      },
    } satisfies AgentAuthContext;
  }

  let verifyJwt: ((token: string) => Promise<JWTPayload>) | null = null;

  if (jwksUri) {
    const url = new URL(jwksUri);
    const domain = `${url.protocol}//${url.host}`;
    const keyResolver = createRemoteJWKSet(url, {
      cacheMaxAge: config?.cacheTtl ?? DEFAULT_JWKS_CACHE_TTL_MS,
      cooldownDuration: config?.jwksCooldownMs ?? DEFAULT_JWKS_COOLDOWN_MS,
      timeoutDuration: config?.jwksTimeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS,
    });
    const allowedIssuers =
      config?.allowedIssuers && config.allowedIssuers.length > 0
        ? config.allowedIssuers
        : [domain];
    const allowedAudiences =
      config?.allowedAudiences && config.allowedAudiences.length > 0
        ? config.allowedAudiences
        : undefined;

    verifyJwt = async (token: string) => {
      const { payload } = await jwtVerify(token, keyResolver, {
        algorithms: [ORY_JWT_ALGORITHM],
        issuer: allowedIssuers,
        ...(allowedAudiences ? { audience: allowedAudiences } : {}),
      });
      return payload;
    };
  }

  async function introspectToken(
    token: string,
    credentialType: TokenValidationEvent['credentialType'],
  ): Promise<IntrospectionResult> {
    try {
      const data = await oauth2Api.introspectOAuth2Token({ token });

      if (!data.active) {
        recordValidationEvent({
          credentialType,
          reason: 'credential_inactive',
        });
        return { active: false };
      }

      const scopes = data.scope ? data.scope.split(' ').filter(Boolean) : [];
      recordValidationEvent({
        credentialType,
        reason: 'credential_accepted',
      });

      return {
        active: true,
        clientId: data.client_id ?? '',
        scopes,
        expiresAt: data.exp,
        ext: (data.ext as Record<string, unknown>) ?? {},
      };
    } catch (error) {
      const errorSummary = summarizeOryError(error);
      recordValidationEvent({
        credentialType,
        reason: 'introspection_unavailable',
      });
      logger.warn(
        {
          credentialType,
          reason: 'introspection_unavailable',
          ...errorSummary,
        },
        'Ory token introspection unavailable',
      );
      return { active: false };
    }
  }

  async function introspect(token: string): Promise<IntrospectionResult> {
    return introspectToken(token, 'ory-token');
  }

  async function validateJwt(token: string): Promise<JwtValidationResult> {
    if (!verifyJwt) {
      return { result: { active: false } };
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

      // Hydra preserves the token-exchange hook's `session.access_token` keys
      // under a nested `ext` object inside the JWT payload (mirrors the shape
      // of the OAuth2 introspection response). Flatten it so downstream claim
      // extraction sees `moltnet:identity_id` regardless of which path
      // produced the IntrospectionResult. Guard against non-plain-object
      // values — `payload.ext` is JSON, so it could be an array, primitive,
      // or null; only a plain object should be merged.
      const nestedExt =
        payload.ext !== null &&
        typeof payload.ext === 'object' &&
        !Array.isArray(payload.ext)
          ? (payload.ext as Record<string, unknown>)
          : null;
      const flatExt =
        nestedExt && Object.keys(nestedExt).length > 0
          ? { ...payload, ...nestedExt }
          : (payload as Record<string, unknown>);

      recordValidationEvent({
        credentialType: 'ory-jwt',
        reason: 'credential_accepted',
      });

      return {
        result: {
          active: true,
          clientId,
          scopes,
          expiresAt: payload.exp,
          ext: flatExt,
        },
      };
    } catch (error) {
      const failure = summarizeJwtError(error);
      const logContext = {
        credentialType: 'ory-jwt',
        ...failure,
      };
      recordValidationEvent({
        credentialType: 'ory-jwt',
        reason: failure.reason,
      });
      if (failure.reason === 'jwks_unavailable') {
        logger.warn(logContext, 'Ory JWT verification unavailable');
      } else if (failure.reason === 'unexpected') {
        logger.warn(logContext, 'Ory JWT verification failed unexpectedly');
      } else {
        logger.debug(logContext, 'Ory JWT rejected');
      }
      return { failure, result: { active: false } };
    }
  }

  return {
    introspect,

    async resolveAuthContext(token: string): Promise<AuthContext | null> {
      if (
        config?.talosApi &&
        config.resolveTalosAgent &&
        isTalosApiKey(token)
      ) {
        return resolveTalosApiKey(token);
      }

      let result: IntrospectionResult;

      if (isOpaqueToken(token)) {
        result = await introspectToken(token, 'ory-opaque');
      } else if (verifyJwt && isJwtToken(token)) {
        const jwtValidation = await validateJwt(token);
        result = jwtValidation.result;
        if (
          !result.active &&
          'failure' in jwtValidation &&
          shouldIntrospectJwtFailure(jwtValidation.failure.reason)
        ) {
          recordValidationEvent({
            credentialType: 'ory-jwt',
            reason: 'introspection_fallback',
          });
          result = await introspectToken(token, 'ory-jwt');
        }
      } else {
        result = await introspectToken(token, 'ory-token');
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
      return fetchClientMetadata(oauth2Api, clientId, scopes, logger);
    },
  };
}
