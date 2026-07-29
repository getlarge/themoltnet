import {
  createRemoteJWKSet,
  errors,
  type JWTPayload,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
} from 'jose';
import { Value } from 'typebox/value';

import {
  type ConnectorCredentialClaims as ConnectorClaims,
  ConnectorCredentialClaims,
  CREDENTIAL_CLAIM_NAMESPACE,
  type TaskCredentialClaims as TaskClaims,
  TaskCredentialClaims,
} from './contracts.js';
import { CredentialError } from './errors.js';

export const CREDENTIAL_JWT_ALGORITHM = 'EdDSA' as const;
export const DEFAULT_CLOCK_TOLERANCE_SECONDS = 5;
export const JWKS_TIMEOUT_MS = 5_000;
export const JWKS_CACHE_MAX_AGE_MS = 300_000;
export const JWKS_COOLDOWN_MS = 30_000;

interface CommonTaskBindingExpectation {
  agentId?: string;
  teamId?: string;
  taskId?: string;
  attemptN?: number;
  leaseId?: string;
}

export interface TaskCredentialBindingExpectation extends CommonTaskBindingExpectation {
  runtimeKind?: string;
  executorManifestFingerprint?: string;
  runtimeProfileId?: string;
  runtimeProfileRevision?: number;
  policySnapshotHash?: string;
}

export interface ConnectorCredentialBindingExpectation extends CommonTaskBindingExpectation {
  connectorId?: string;
  operation?: string;
  resourceId?: string;
  grantId?: string;
  grantRevision?: number;
  parentTaskJti?: string;
}

interface CredentialVerificationBase {
  issuer: string;
  clockToleranceSeconds?: number;
}

export type CredentialVerificationKeySource =
  | { jwksUrl: string | URL; keyResolver?: never }
  | { keyResolver: JWTVerifyGetKey; jwksUrl?: never };

export type TaskCredentialVerificationOptions = CredentialVerificationBase &
  CredentialVerificationKeySource & {
    expected: TaskCredentialBindingExpectation;
  };

export type ConnectorCredentialVerificationOptions =
  CredentialVerificationBase &
    CredentialVerificationKeySource & {
      expected: ConnectorCredentialBindingExpectation;
    };

type CredentialVerificationOptions =
  | TaskCredentialVerificationOptions
  | ConnectorCredentialVerificationOptions;

export interface VerifiedCredential<TClaims> {
  claims: TClaims;
  issuer: string;
  subject: string;
  expiresAt: Date;
  issuedAt: Date;
  jti: string;
  protectedHeader: { alg: string; kid: string };
}

const remoteResolvers = new Map<string, JWTVerifyGetKey>();

function failClosedResolver(resolver: JWTVerifyGetKey): JWTVerifyGetKey {
  return async (protectedHeader, token) => {
    try {
      return await resolver(protectedHeader, token);
    } catch (error) {
      if (error instanceof errors.JOSEError) throw error;
      throw new CredentialError(
        'credential_verification_unavailable',
        'Credential verification key service is unavailable',
      );
    }
  };
}

function getResolver(options: CredentialVerificationOptions): JWTVerifyGetKey {
  if (options.keyResolver) return failClosedResolver(options.keyResolver);
  const url = new URL(options.jwksUrl);
  const cacheKey = url.href;
  const cached = remoteResolvers.get(cacheKey);
  if (cached) return cached;

  // Keep a resolver per credential trust domain even though Ory authentication
  // also uses jose. Talos keys are Ed25519/OKP and remain hard-pinned to EdDSA.
  const resolver = failClosedResolver(
    createRemoteJWKSet(url, {
      timeoutDuration: JWKS_TIMEOUT_MS,
      cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
      cooldownDuration: JWKS_COOLDOWN_MS,
    }),
  );
  remoteResolvers.set(cacheKey, resolver);
  return resolver;
}

function verificationFailure(error: unknown): CredentialError {
  if (error instanceof errors.JWTExpired) {
    return new CredentialError('credential_expired', 'Credential has expired');
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) {
    return new CredentialError(
      'credential_signature_invalid',
      'Credential signature is invalid',
    );
  }
  if (error instanceof errors.JWKSTimeout) {
    return new CredentialError(
      'credential_verification_unavailable',
      'Credential verification key service is unavailable',
    );
  }
  return new CredentialError(
    'credential_invalid',
    'Credential verification failed',
  );
}

function requireStandardClaims(payload: JWTPayload) {
  if (
    typeof payload.iss !== 'string' ||
    typeof payload.sub !== 'string' ||
    typeof payload.exp !== 'number' ||
    typeof payload.iat !== 'number' ||
    typeof payload.jti !== 'string'
  ) {
    throw new CredentialError(
      'credential_invalid',
      'Credential is missing required standard claims',
    );
  }
  return {
    issuer: payload.iss,
    subject: payload.sub,
    expiresAt: new Date(payload.exp * 1_000),
    issuedAt: new Date(payload.iat * 1_000),
    jti: payload.jti,
  };
}

function mismatch(name: string): never {
  throw new CredentialError(
    'credential_binding_mismatch',
    `Credential ${name} binding does not match`,
  );
}

type TaskBindingClaims = Pick<
  TaskClaims,
  'agentId' | 'teamId' | 'taskId' | 'attemptN' | 'leaseId'
>;

function validateCommonTaskBindings(
  claims: TaskBindingClaims,
  expected: CommonTaskBindingExpectation,
): void {
  if (expected.agentId !== undefined && claims.agentId !== expected.agentId)
    mismatch('agent');
  if (expected.teamId !== undefined && claims.teamId !== expected.teamId)
    mismatch('team');
  if (expected.taskId !== undefined && claims.taskId !== expected.taskId)
    mismatch('task');
  if (expected.attemptN !== undefined && claims.attemptN !== expected.attemptN)
    mismatch('attempt');
  if (expected.leaseId !== undefined && claims.leaseId !== expected.leaseId)
    mismatch('lease');
}

function validateTaskBindings(
  claims: TaskClaims,
  expected: TaskCredentialBindingExpectation,
): void {
  validateCommonTaskBindings(claims, expected);
  if (
    expected.runtimeKind !== undefined &&
    claims.runtimeKind !== expected.runtimeKind
  )
    mismatch('runtime kind');
  if (
    expected.executorManifestFingerprint !== undefined &&
    claims.executorManifestFingerprint !== expected.executorManifestFingerprint
  )
    mismatch('executor manifest');
  if (
    expected.runtimeProfileId !== undefined &&
    claims.runtimeProfileId !== expected.runtimeProfileId
  )
    mismatch('runtime profile');
  if (
    expected.runtimeProfileRevision !== undefined &&
    claims.runtimeProfileRevision !== expected.runtimeProfileRevision
  )
    mismatch('runtime profile revision');
  if (
    expected.policySnapshotHash !== undefined &&
    claims.policySnapshotHash !== expected.policySnapshotHash
  )
    mismatch('policy snapshot');
}

function validateConnectorBindings(
  claims: ConnectorClaims,
  expected: ConnectorCredentialBindingExpectation,
): void {
  validateCommonTaskBindings(claims.task, expected);
  if (
    expected.connectorId !== undefined &&
    claims.connectorId !== expected.connectorId
  )
    mismatch('connector');
  if (
    expected.operation !== undefined &&
    claims.operation !== expected.operation
  )
    mismatch('operation');
  if (
    expected.resourceId !== undefined &&
    claims.resourceId !== expected.resourceId
  )
    mismatch('resource');
  if (expected.grantId !== undefined && claims.grantId !== expected.grantId)
    mismatch('grant');
  if (
    expected.grantRevision !== undefined &&
    claims.grantRevision !== expected.grantRevision
  )
    mismatch('grant revision');
  if (
    expected.parentTaskJti !== undefined &&
    claims.parentTaskJti !== expected.parentTaskJti
  )
    mismatch('parent task lineage');
}

async function verify<TClaims>(
  token: string,
  kind: 'task' | 'connector',
  options: CredentialVerificationOptions,
): Promise<VerifiedCredential<TClaims>> {
  try {
    const jwtOptions: JWTVerifyOptions = {
      issuer: options.issuer,
      algorithms: [CREDENTIAL_JWT_ALGORITHM],
      clockTolerance:
        options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['iss', 'sub', 'exp', 'iat', 'jti'],
    };
    const result = await jwtVerify(token, getResolver(options), jwtOptions);
    const standard = requireStandardClaims(result.payload);
    if (
      typeof result.protectedHeader.kid !== 'string' ||
      result.protectedHeader.kid.length === 0
    ) {
      throw new CredentialError(
        'credential_invalid',
        'Credential is missing a key identifier',
      );
    }
    const custom = result.payload[CREDENTIAL_CLAIM_NAMESPACE];
    const schema =
      kind === 'task' ? TaskCredentialClaims : ConnectorCredentialClaims;
    if (!Value.Check(schema, custom)) {
      throw new CredentialError(
        'credential_invalid',
        `Credential does not contain valid ${kind} claims`,
      );
    }
    if (kind === 'task') {
      const taskClaims = custom as TaskClaims;
      if (standard.subject !== taskClaims.agentId) mismatch('subject');
      validateTaskBindings(
        taskClaims,
        options.expected as TaskCredentialBindingExpectation,
      );
    } else {
      const connectorClaims = custom as ConnectorClaims;
      if (standard.subject !== connectorClaims.task.agentId)
        mismatch('subject');
      validateConnectorBindings(
        connectorClaims,
        options.expected as ConnectorCredentialBindingExpectation,
      );
    }
    return {
      claims: custom as TClaims,
      ...standard,
      protectedHeader: {
        alg: result.protectedHeader.alg,
        kid: result.protectedHeader.kid,
      },
    };
  } catch (error) {
    if (error instanceof CredentialError) throw error;
    throw verificationFailure(error);
  }
}

export function verifyTaskCredential(
  token: string,
  options: TaskCredentialVerificationOptions,
): Promise<VerifiedCredential<TaskClaims>> {
  return verify<TaskClaims>(token, 'task', options);
}

export function verifyConnectorCredential(
  token: string,
  options: ConnectorCredentialVerificationOptions,
): Promise<VerifiedCredential<ConnectorClaims>> {
  return verify<ConnectorClaims>(token, 'connector', options);
}
