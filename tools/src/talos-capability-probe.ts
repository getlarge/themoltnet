import {
  ApiKeysApi,
  Configuration,
  KeyVisibility,
  RevocationReason,
  TokenAlgorithm,
  type VerifyApiKeyResponse,
} from '@ory/client-fetch';
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  type JSONWebKeySet,
  type JWTPayload,
  jwtVerify,
} from 'jose';

export type ProbeMode = 'local' | 'managed';
export type ProbeStatus = 'supported' | 'rejected' | 'failed';

export interface CapabilityObservation {
  id: string;
  status: ProbeStatus;
  detail: string;
}

export interface TalosCapabilityReport {
  schemaVersion: 1;
  mode: ProbeMode;
  adminOrigin: string;
  generatedAt: string;
  talosImage: 'oryd/talos:v26.2.0' | 'managed';
  disposableKeyRevoked: boolean;
  observations: CapabilityObservation[];
  conclusion: {
    jwtV1Ready: boolean;
    jwtChaining: boolean;
    callerSelectedAudience: boolean;
    connectorMode: 'chained' | 'exchange';
    managedParityRequired: boolean;
  };
}

export interface TalosProbeOptions {
  mode: ProbeMode;
  adminUrl: string;
  apiKey?: string;
  now?: () => Date;
}

class ProbeAssertionError extends Error {}

const READ_SCOPE = 'moltnet:probe:read';
const WRITE_SCOPE = 'moltnet:probe:write';

function safeFailure(error: unknown): string {
  if (error instanceof ProbeAssertionError) return 'assertion_failed';
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { status?: number } }).response;
    if (typeof response?.status === 'number') return `http_${response.status}`;
  }
  return error instanceof TypeError ? 'network_failure' : 'request_failed';
}

function expectValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ProbeAssertionError(message);
}

function hasScopes(
  actual: readonly string[] | undefined,
  expected: readonly string[],
): boolean {
  return (
    actual?.length === expected.length &&
    expected.every((scope) => actual.includes(scope))
  );
}

async function expectRejected(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return safeFailure(error);
  }
  throw new ProbeAssertionError('request unexpectedly succeeded');
}

function createApi(options: TalosProbeOptions): ApiKeysApi {
  const accessToken = options.apiKey
    ? { accessToken: options.apiKey }
    : undefined;
  return new ApiKeysApi(
    new Configuration({
      basePath: options.adminUrl,
      ...accessToken,
      fetchApi: async (input, init) => {
        const signal = init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000);
        return fetch(input, { ...init, signal });
      },
    }),
  );
}

export async function runTalosCapabilityProbe(
  options: TalosProbeOptions,
): Promise<TalosCapabilityReport> {
  const api = createApi(options);
  const observations: CapabilityObservation[] = [];
  const keyIds = new Set<string>();
  const now = options.now ?? (() => new Date());
  let disposableKeyRevoked = false;
  let parentSecret: string | undefined;
  let parentKeyId: string | undefined;
  let jwt: string | undefined;
  let jwtPayload: JWTPayload | undefined;
  let jwksResolver: ReturnType<typeof createLocalJWKSet> | undefined;
  let macaroon: string | undefined;
  const actorId = `talos-probe-${crypto.randomUUID()}`;

  async function observe(
    id: string,
    run: () => Promise<string>,
  ): Promise<boolean> {
    try {
      observations.push({ id, status: 'supported', detail: await run() });
      return true;
    } catch (error) {
      observations.push({
        id,
        status: error instanceof ProbeAssertionError ? 'failed' : 'rejected',
        detail: safeFailure(error),
      });
      return false;
    }
  }

  async function derive(input: {
    credential: string;
    algorithm: (typeof TokenAlgorithm)[keyof typeof TokenAlgorithm];
    scopes?: string[];
    ttl?: string;
    customClaims?: object;
  }) {
    const result = await api.adminDeriveToken({
      deriveTokenRequest: {
        algorithm: input.algorithm,
        credential: input.credential,
        scopes: input.scopes,
        ttl: input.ttl,
        custom_claims: input.customClaims,
      },
    });
    expectValue(result.token?.token, 'missing token');
    expectValue(result.token.expire_time, 'missing expiry');
    return result.token;
  }

  async function verifyOnline(
    credential: string,
    cacheControl = 'no-store',
  ): Promise<VerifyApiKeyResponse> {
    return api.adminVerifyApiKey({
      verifyApiKeyRequest: { credential },
      cacheControl,
      pragma: 'no-cache',
    });
  }

  try {
    const issued = await api.adminIssueApiKey({
      issueApiKeyRequest: {
        actor_id: actorId,
        name: 'MoltNet disposable capability probe',
        scopes: [READ_SCOPE, WRITE_SCOPE],
        ttl: '300s',
        visibility: KeyVisibility.KeyVisibilitySecret,
        metadata: {
          schema_version: 1,
          purpose: 'talos_capability_probe',
        },
      },
    });
    expectValue(issued.secret, 'Talos did not return the disposable secret');
    expectValue(
      issued.issued_api_key?.key_id,
      'Talos did not return the disposable key ID',
    );
    parentSecret = issued.secret;
    parentKeyId = issued.issued_api_key.key_id;
    keyIds.add(parentKeyId);

    await observe('online_verify_agent_key', async () => {
      const result = await verifyOnline(parentSecret!);
      expectValue(result.is_valid, 'agent key was not valid');
      expectValue(
        hasScopes(result.scopes, [READ_SCOPE, WRITE_SCOPE]),
        'agent scopes differed',
      );
      return 'valid_with_exact_scopes';
    });

    await observe('agent_key_to_jwt', async () => {
      const result = await derive({
        credential: parentSecret!,
        algorithm: TokenAlgorithm.TokenAlgorithmJwt,
        scopes: [READ_SCOPE],
        ttl: '120s',
        customClaims: {
          probe_claim: {
            marker: 'preserved',
            version: 1,
          },
        },
      });
      jwt = result.token;
      expectValue(hasScopes(result.scopes, [READ_SCOPE]), 'JWT was not narrow');
      return 'jwt_issued';
    });

    await observe('jwks_offline_verification', async () => {
      expectValue(jwt, 'JWT derivation prerequisite failed');
      const response = await api.getJwks();
      expectValue(response.jwks?.keys.length, 'JWKS was empty');
      jwksResolver = createLocalJWKSet(
        response.jwks as unknown as JSONWebKeySet,
      );
      const verified = await jwtVerify(jwt, jwksResolver);
      jwtPayload = verified.payload;
      return 'signature_valid';
    });

    await observe('custom_claim_preservation', async () => {
      expectValue(jwtPayload, 'offline verification prerequisite failed');
      const claim = jwtPayload.probe_claim as
        | { marker?: string; version?: number }
        | undefined;
      expectValue(
        claim?.marker === 'preserved' && claim.version === 1,
        'custom claim changed',
      );
      return 'nested_claim_preserved';
    });

    await observe('reserved_aud_behavior', async () => {
      expectValue(jwksResolver, 'JWKS prerequisite failed');
      try {
        const result = await derive({
          credential: parentSecret!,
          algorithm: TokenAlgorithm.TokenAlgorithmJwt,
          ttl: '60s',
          customClaims: { aud: 'talos-probe-audience' },
        });
        const verified = await jwtVerify(result.token!, jwksResolver);
        return verified.payload.aud === 'talos-probe-audience'
          ? 'caller_selected_audience_preserved'
          : 'accepted_but_audience_stripped';
      } catch (error) {
        return `rejected_${safeFailure(error)}`;
      }
    });

    await observe('scope_inheritance', async () => {
      const result = await derive({
        credential: parentSecret!,
        algorithm: TokenAlgorithm.TokenAlgorithmJwt,
        ttl: '60s',
      });
      expectValue(
        hasScopes(result.scopes, [READ_SCOPE, WRITE_SCOPE]),
        'parent scopes were not inherited',
      );
      return 'exact_parent_scopes';
    });

    await observe('derived_jwt_to_narrower_jwt', async () => {
      expectValue(jwt, 'JWT derivation prerequisite failed');
      await derive({
        credential: jwt,
        algorithm: TokenAlgorithm.TokenAlgorithmJwt,
        scopes: [READ_SCOPE],
        ttl: '60s',
      });
      return 'chaining_supported';
    });

    await observe('scope_widening_rejected', async () => {
      expectValue(jwt, 'JWT derivation prerequisite failed');
      return expectRejected(() =>
        derive({
          credential: jwt!,
          algorithm: TokenAlgorithm.TokenAlgorithmJwt,
          scopes: [READ_SCOPE, WRITE_SCOPE],
          ttl: '60s',
        }),
      );
    });

    await observe('child_ttl_equal_parent_request', async () => {
      expectValue(jwt, 'JWT derivation prerequisite failed');
      const result = await derive({
        credential: jwt,
        algorithm: TokenAlgorithm.TokenAlgorithmJwt,
        scopes: [READ_SCOPE],
        ttl: '120s',
      });
      return `accepted_until_${result.expire_time!.toISOString()}`;
    });

    await observe('child_ttl_greater_parent_rejected', async () => {
      expectValue(jwt, 'JWT derivation prerequisite failed');
      return expectRejected(() =>
        derive({
          credential: jwt!,
          algorithm: TokenAlgorithm.TokenAlgorithmJwt,
          scopes: [READ_SCOPE],
          ttl: '300s',
        }),
      );
    });

    await observe('agent_key_to_macaroon', async () => {
      const result = await derive({
        credential: parentSecret!,
        algorithm: TokenAlgorithm.TokenAlgorithmMacaroon,
        scopes: [READ_SCOPE],
        ttl: '120s',
      });
      macaroon = result.token;
      return 'macaroon_issued';
    });

    await observe('online_verify_jwt', async () => {
      expectValue(jwt, 'JWT derivation prerequisite failed');
      const result = await verifyOnline(jwt);
      expectValue(result.is_valid, 'JWT was not valid online');
      expectValue(result.actor_id === actorId, 'actor was not inherited');
      expectValue(
        (result.metadata as { purpose?: string } | undefined)?.purpose ===
          'talos_capability_probe',
        'metadata was not inherited',
      );
      expectValue(
        hasScopes(result.scopes, [READ_SCOPE]),
        'narrowed scope was not preserved',
      );
      return 'valid_with_actor_metadata_and_scope';
    });

    await observe('online_verify_macaroon', async () => {
      expectValue(macaroon, 'macaroon derivation prerequisite failed');
      const result = await verifyOnline(macaroon);
      expectValue(result.is_valid, 'macaroon was not valid online');
      return 'valid';
    });

    await observe('derived_macaroon_to_jwt', async () => {
      expectValue(macaroon, 'macaroon derivation prerequisite failed');
      await derive({
        credential: macaroon,
        algorithm: TokenAlgorithm.TokenAlgorithmJwt,
        scopes: [READ_SCOPE],
        ttl: '60s',
      });
      return 'chaining_supported';
    });

    await observe('derived_macaroon_to_macaroon', async () => {
      expectValue(macaroon, 'macaroon derivation prerequisite failed');
      await derive({
        credential: macaroon,
        algorithm: TokenAlgorithm.TokenAlgorithmMacaroon,
        scopes: [READ_SCOPE],
        ttl: '60s',
      });
      return 'chaining_supported';
    });

    await observe('jwt_claim_lineage', async () => {
      expectValue(jwtPayload, 'offline verification prerequisite failed');
      const header = decodeProtectedHeader(jwt!);
      expectValue(typeof jwtPayload.iss === 'string', 'issuer missing');
      expectValue(typeof jwtPayload.sub === 'string', 'subject missing');
      expectValue(typeof jwtPayload.jti === 'string', 'jti missing');
      expectValue(typeof header.kid === 'string', 'key id missing');
      return 'issuer_subject_jti_kid_present';
    });

    await observe('rotation_blocks_old_parent_derivation', async () => {
      const oldSecret = parentSecret!;
      const rotated = await api.adminRotateIssuedApiKey({
        keyId: parentKeyId!,
        adminRotateIssuedApiKeyBody: {
          name: 'MoltNet disposable capability probe (rotated)',
          scopes: [READ_SCOPE, WRITE_SCOPE],
          visibility: KeyVisibility.KeyVisibilitySecret,
          metadata: {
            schema_version: 1,
            purpose: 'talos_capability_probe',
          },
        },
      });
      expectValue(rotated.secret, 'rotation did not return a new secret');
      expectValue(
        rotated.issued_api_key?.key_id,
        'rotation did not return a new key ID',
      );
      parentSecret = rotated.secret;
      parentKeyId = rotated.issued_api_key.key_id;
      keyIds.add(parentKeyId);
      return expectRejected(() =>
        derive({
          credential: oldSecret,
          algorithm: TokenAlgorithm.TokenAlgorithmJwt,
          ttl: '30s',
        }),
      );
    });

    await observe('online_child_after_parent_rotation', async () => {
      expectValue(jwt, 'JWT derivation prerequisite failed');
      const result = await verifyOnline(jwt);
      return result.is_valid ? 'still_valid' : 'invalidated';
    });

    await observe('offline_child_after_parent_rotation', async () => {
      expectValue(
        jwt && jwksResolver,
        'offline verification prerequisite failed',
      );
      await jwtVerify(jwt, jwksResolver);
      return 'still_valid';
    });

    await api.adminRevokeIssuedApiKey({
      keyId: parentKeyId,
      adminRevokeIssuedApiKeyBody: {
        reason: RevocationReason.RevocationReasonSuperseded,
      },
    });
    disposableKeyRevoked = true;

    await observe('revocation_blocks_new_derivation', async () =>
      expectRejected(() =>
        derive({
          credential: parentSecret!,
          algorithm: TokenAlgorithm.TokenAlgorithmJwt,
          ttl: '30s',
        }),
      ),
    );

    await observe('online_child_after_parent_revocation', async () => {
      expectValue(jwt, 'JWT derivation prerequisite failed');
      const result = await verifyOnline(jwt);
      return result.is_valid ? 'still_valid' : 'invalidated';
    });

    await observe('offline_child_after_parent_revocation', async () => {
      expectValue(
        jwt && jwksResolver,
        'offline verification prerequisite failed',
      );
      await jwtVerify(jwt, jwksResolver);
      return 'still_valid_until_expiry';
    });

    await observe('verification_cache_controls', async () => {
      const result = await api.adminVerifyApiKey({
        verifyApiKeyRequest: { credential: 'invalid-probe-credential' },
        cacheControl: 'no-store',
        pragma: 'no-cache',
      });
      expectValue(!result.is_valid, 'invalid credential was accepted');
      return 'invalid_rejected_with_no_store';
    });
  } finally {
    for (const keyId of keyIds) {
      try {
        await api.adminRevokeIssuedApiKey({
          keyId,
          adminRevokeIssuedApiKeyBody: {
            reason: RevocationReason.RevocationReasonSuperseded,
          },
        });
        disposableKeyRevoked = true;
      } catch {
        // Rotation and an earlier explicit revocation make repeat cleanup fail.
      }
    }
    parentSecret = undefined;
    jwt = undefined;
    macaroon = undefined;
  }

  const jwtChaining =
    observations.find((row) => row.id === 'derived_jwt_to_narrower_jwt')
      ?.status === 'supported';
  const callerSelectedAudience =
    observations.find((row) => row.id === 'reserved_aud_behavior')?.detail ===
    'caller_selected_audience_preserved';
  const required = [
    'online_verify_agent_key',
    'agent_key_to_jwt',
    'jwks_offline_verification',
    'custom_claim_preservation',
    'reserved_aud_behavior',
    'scope_inheritance',
    'scope_widening_rejected',
  ];
  const jwtV1Ready = required.every(
    (id) => observations.find((row) => row.id === id)?.status === 'supported',
  );

  return {
    schemaVersion: 1,
    mode: options.mode,
    adminOrigin: new URL(options.adminUrl).origin,
    generatedAt: now().toISOString(),
    talosImage: options.mode === 'local' ? 'oryd/talos:v26.2.0' : 'managed',
    disposableKeyRevoked,
    observations,
    conclusion: {
      jwtV1Ready,
      jwtChaining,
      callerSelectedAudience,
      connectorMode: jwtChaining ? 'chained' : 'exchange',
      managedParityRequired: options.mode === 'local',
    },
  };
}

function readOptions(): TalosProbeOptions {
  const mode = process.env.TALOS_PROBE_MODE ?? 'local';
  if (mode !== 'local' && mode !== 'managed') {
    throw new Error('TALOS_PROBE_MODE must be local or managed');
  }
  const adminUrl =
    process.env.TALOS_PROBE_ADMIN_URL ??
    (mode === 'local' ? 'http://localhost:4420' : undefined);
  if (!adminUrl) {
    throw new Error('TALOS_PROBE_ADMIN_URL is required in managed mode');
  }
  const apiKey = process.env.TALOS_PROBE_API_KEY;
  if (mode === 'managed' && !apiKey) {
    throw new Error('TALOS_PROBE_API_KEY is required in managed mode');
  }
  return { mode, adminUrl, apiKey };
}

async function main(): Promise<void> {
  try {
    const report = await runTalosCapabilityProbe(readOptions());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.conclusion.jwtV1Ready || !report.disposableKeyRevoked) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        fatal: safeFailure(error),
        disposableKeyRevoked: false,
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
