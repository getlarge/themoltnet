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

import { readAgentKeyMetadataBinding } from './agent-key-binding.js';
import { ORY_OPAQUE_PREFIXES, TALOS_API_KEY_PREFIXES } from './constants.js';
import {
  createRemoteAuthMetrics,
  RemoteAuthCache,
  type RemoteAuthMetrics,
} from './remote-auth-cache.js';
import {
  asRemoteAuthenticationError,
  remoteErrorStatus,
} from './remote-auth-error.js';
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
  /** Shared process-local cache for authentication that requires Ory calls. */
  remoteAuthCache?: RemoteAuthCache;
  /** Stable issuer used to partition OAuth cache keys. */
  oauthIssuer?: string;
  /** Stable issuer used to partition Talos cache keys. */
  talosIssuer?: string;
  /** Timeout for individual remote authentication calls. */
  remoteRequestTimeoutMs?: number;
}

export interface TalosAgentIdentity {
  /** Internal `agents.id` — used as the Keto subject. */
  agentId: string;
  identityId: string;
  publicKey: string;
  fingerprint: string;
}

export type TalosAgentResolver = (
  identityId: string,
  signal?: AbortSignal,
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
  credentialType: 'ory-jwt' | 'ory-opaque' | 'ory-token' | 'talos-api-key';
  reason: TokenValidationReason;
  /** Non-secret Talos key identifier, when verification returned one. */
  keyId?: string;
  bindingScope?: 'identity' | 'team';
}

export interface TokenValidator {
  introspect(token: string): Promise<IntrospectionResult>;
  resolveAuthContext(token: string): Promise<AuthContext | null>;
  evictOAuthClient(clientId: string): void;
  evictTalosKey(keyId: string): void;
}

const ORY_JWT_ALGORITHM = 'RS256' as const;
const DEFAULT_JWKS_CACHE_TTL_MS = 600_000;
const DEFAULT_JWKS_COOLDOWN_MS = 30_000;
const DEFAULT_JWKS_TIMEOUT_MS = 5_000;
const MAX_AUTH_SCOPES = 128;
const MAX_AUTH_SCOPE_LENGTH = 256;

function normalizeScopes(value: unknown): string[] {
  const candidates =
    typeof value === 'string'
      ? value.split(' ')
      : Array.isArray(value)
        ? value
        : [];
  const scopes: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const scope = candidate.trim();
    if (!scope || scope.length > MAX_AUTH_SCOPE_LENGTH || seen.has(scope)) {
      continue;
    }
    scopes.push(scope);
    seen.add(scope);
    if (scopes.length === MAX_AUTH_SCOPES) break;
  }
  return scopes;
}

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

  // Tokens minted before the webhook emitted moltnet:agent_id stay valid for
  // their full 24h life (and are served from the grant cache for it), so fall
  // back to the identity. That is correct rather than an alias: migration 0041
  // seeds agents.id from identity_id, so for every agent predating this change
  // the two values are equal. Remove once no pre-change token can be live.
  const agentId =
    (claims['moltnet:agent_id'] as string | undefined) ?? identityId;

  return {
    subjectType: 'agent',
    agentId,
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
  metrics: RemoteAuthMetrics | undefined,
  signal: AbortSignal | undefined,
): Promise<AuthContext | null> {
  try {
    const client = signal
      ? await oauth2Api.getOAuth2Client({ id: clientId }, { signal })
      : await oauth2Api.getOAuth2Client({ id: clientId });
    const metadata = client.metadata as Record<string, string> | undefined;
    if (!metadata) {
      metrics?.recordUpstreamRequest('oauth2.client_metadata', 'invalid');
      return null;
    }

    const metaIdentityId = metadata.identity_id;
    if (!metaIdentityId) {
      metrics?.recordUpstreamRequest('oauth2.client_metadata', 'invalid');
      return null;
    }

    const metaType = metadata.type;

    if (metaType === 'moltnet_human') {
      const metaHumanId = metadata.human_id;
      if (!metaHumanId) {
        metrics?.recordUpstreamRequest('oauth2.client_metadata', 'invalid');
        return null;
      }
      metrics?.recordUpstreamRequest('oauth2.client_metadata', 'success');
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
      metrics?.recordUpstreamRequest('oauth2.client_metadata', 'invalid');
      return null;
    }

    metrics?.recordUpstreamRequest('oauth2.client_metadata', 'success');
    return {
      subjectType: 'agent',
      // agent_id is backfilled on every MoltNet client; identity_id remains a
      // correct fallback for any client created before that backfill.
      agentId: metadata.agent_id ?? metaIdentityId,
      identityId: metaIdentityId,
      publicKey: metaPublicKey,
      fingerprint: metaFingerprint,
      clientId,
      scopes,
      currentTeamId: null,
    } satisfies AgentAuthContext;
  } catch (error) {
    const status = remoteErrorStatus(error);
    if (status === 404) {
      metrics?.recordUpstreamRequest(
        'oauth2.client_metadata',
        'invalid',
        status,
      );
      return null;
    }
    logger.warn(
      {
        credentialType: 'ory-client-metadata',
        reason: 'metadata_lookup_unavailable',
        ...summarizeOryError(error),
      },
      'Ory client metadata unavailable',
    );
    if (metrics) {
      throw asRemoteAuthenticationError(
        error,
        'oauth2.client_metadata',
        metrics,
      );
    }
    throw error;
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
  const remoteCache =
    config?.remoteAuthCache ??
    new RemoteAuthCache({ metrics: createRemoteAuthMetrics() });
  const remoteMetrics = remoteCache.metrics;
  const requestTimeoutMs = config?.remoteRequestTimeoutMs ?? 5_000;
  const signal = () => AbortSignal.timeout(requestTimeoutMs);

  async function resolveTalosApiKey(
    token: string,
  ): Promise<AgentAuthContext | null> {
    if (!config?.talosApi || !config.resolveTalosAgent) return null;
    const talosApi = config.talosApi;
    const resolveTalosAgent = config.resolveTalosAgent;

    const load = async () => {
      let result: Awaited<
        ReturnType<Pick<ApiKeysApi, 'adminVerifyApiKey'>['adminVerifyApiKey']>
      >;
      try {
        result = await talosApi.adminVerifyApiKey({
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
        throw asRemoteAuthenticationError(error, 'talos.verify', remoteMetrics);
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
        remoteMetrics?.recordUpstreamRequest('talos.verify', 'invalid');
        recordValidationEvent({
          credentialType: 'talos-api-key',
          reason: expired ? 'credential_expired' : 'credential_inactive',
          ...(result.key_id ? { keyId: result.key_id } : {}),
        });
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
        recordValidationEvent({
          credentialType: 'talos-api-key',
          reason: 'token_invalid',
          ...(result.key_id ? { keyId: result.key_id } : {}),
        });
        logger.warn(
          {
            credentialType: 'talos-api-key',
            reason: 'incomplete_verification_response',
          },
          'Talos API key validation failed',
        );
        throw asRemoteAuthenticationError(
          new Error('incomplete Talos response'),
          'talos.verify',
          remoteMetrics,
        );
      }
      const metadata = asMetadata(result.metadata);
      const binding = readAgentKeyMetadataBinding(result.metadata);
      if (!binding) {
        remoteMetrics.recordUpstreamRequest('talos.verify', 'invalid');
        recordValidationEvent({
          credentialType: 'talos-api-key',
          reason: 'token_invalid',
          keyId: result.key_id,
          ...(metadata.binding_scope === 'identity' ||
          metadata.binding_scope === 'team'
            ? { bindingScope: metadata.binding_scope }
            : {}),
        });
        logger.warn(
          {
            credentialType: 'talos-api-key',
            reason: 'invalid_credential_binding',
            keyId: result.key_id,
            actorId: result.actor_id,
          },
          'Talos API key metadata rejected',
        );
        return null;
      }

      remoteMetrics.recordUpstreamRequest('talos.verify', 'success');

      let agent: TalosAgentIdentity | null;
      try {
        agent = await resolveTalosAgent(result.actor_id, signal());
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
        throw asRemoteAuthenticationError(
          error,
          'talos.agent_resolution',
          remoteMetrics,
        );
      }
      if (!agent || agent.identityId !== result.actor_id) {
        remoteMetrics.recordUpstreamRequest(
          'talos.agent_resolution',
          'invalid',
        );
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
      remoteMetrics.recordUpstreamRequest('talos.agent_resolution', 'success');

      logger.debug(
        {
          credentialType: 'talos-api-key',
          reason: 'credential_accepted',
          keyId: result.key_id,
          bindingScope: binding.bindingScope,
          actorId: result.actor_id,
          scopeCount: result.scopes?.length ?? 0,
        },
        'Talos API key accepted',
      );
      recordValidationEvent({
        credentialType: 'talos-api-key',
        reason: 'credential_accepted',
        keyId: result.key_id,
        bindingScope: binding.bindingScope,
      });

      return {
        context: {
          subjectType: 'agent',
          agentId: agent.agentId,
          identityId: agent.identityId,
          publicKey: agent.publicKey,
          fingerprint: agent.fingerprint,
          clientId: result.key_id,
          scopes: normalizeScopes(result.scopes),
          currentTeamId: null,
          credentialBinding:
            binding.bindingScope === 'team'
              ? {
                  bindingScope: 'team',
                  keyId: result.key_id,
                  boundTeamId: binding.teamId,
                }
              : { bindingScope: 'identity', keyId: result.key_id },
        } satisfies AgentAuthContext,
        expiresAtMs: result.expire_time?.getTime(),
        invalidationTag: `talos-key:${result.key_id}`,
      };
    };

    const context = await remoteCache.resolve(
      'talos',
      config.talosIssuer ?? 'talos',
      token,
      load,
    );
    return context?.subjectType === 'agent' ? context : null;
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
      const data = await oauth2Api.introspectOAuth2Token(
        { token },
        { signal: signal() },
      );

      if (!data.active) {
        recordValidationEvent({
          credentialType,
          reason: 'credential_inactive',
        });
        remoteMetrics?.recordUpstreamRequest('oauth2.introspect', 'invalid');
        return { active: false };
      }
      remoteMetrics?.recordUpstreamRequest('oauth2.introspect', 'success');

      const scopes = normalizeScopes(data.scope);
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
      throw asRemoteAuthenticationError(
        error,
        'oauth2.introspect',
        remoteMetrics,
      );
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
      const scopes = normalizeScopes(payload.scope ?? payload.scp);

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

  async function resolveRemoteOAuthContext(
    token: string,
    credentialType: TokenValidationEvent['credentialType'],
  ): Promise<AuthContext | null> {
    return remoteCache.resolve(
      'oauth2',
      config?.oauthIssuer ?? 'oauth2',
      token,
      async () => {
        const result = await introspectToken(token, credentialType);
        if (!result.active || !result.clientId) return null;
        const fromClaims = extractAuthContextFromClaims(
          result.ext,
          result.clientId,
          result.scopes,
        );
        const context =
          fromClaims ??
          (await fetchClientMetadata(
            oauth2Api,
            result.clientId,
            result.scopes,
            logger,
            remoteMetrics,
            signal(),
          ));
        return context
          ? {
              context,
              expiresAtMs: result.expiresAt
                ? result.expiresAt * 1_000
                : undefined,
              invalidationTag: `oauth-client:${result.clientId}`,
            }
          : null;
      },
    );
  }

  async function resolveClientMetadataContext(
    token: string,
    result: IntrospectionResult & { active: true },
  ): Promise<AuthContext | null> {
    return remoteCache.resolve(
      'oauth2',
      config?.oauthIssuer ?? 'oauth2',
      token,
      async () => {
        const context = await fetchClientMetadata(
          oauth2Api,
          result.clientId,
          result.scopes,
          logger,
          remoteMetrics,
          signal(),
        );
        return context
          ? {
              context,
              expiresAtMs: result.expiresAt
                ? result.expiresAt * 1_000
                : undefined,
              invalidationTag: `oauth-client:${result.clientId}`,
            }
          : null;
      },
    );
  }

  return {
    introspect,
    evictOAuthClient(clientId: string): void {
      remoteCache.evictTag(`oauth-client:${clientId}`);
    },
    evictTalosKey(keyId: string): void {
      remoteCache.evictTag(`talos-key:${keyId}`);
    },

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
        return resolveRemoteOAuthContext(token, 'ory-opaque');
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
          return resolveRemoteOAuthContext(token, 'ory-jwt');
        }
        if (!result.active) return null;
      } else {
        return resolveRemoteOAuthContext(token, 'ory-token');
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
      return resolveClientMetadataContext(token, result);
    },
  };
}
