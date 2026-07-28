import {
  createRemoteJWKSet,
  decodeJwt,
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

export interface CredentialBindingExpectation {
  agentId?: string;
  teamId?: string;
  taskId?: string;
  attemptN?: number;
  leaseId?: string;
  runtimeKind?: string;
  capabilityManifestVersion?: string;
  runtimeProfileId?: string;
  runtimeProfileRevision?: number;
  policySnapshotHash?: string;
  connectorId?: string;
  operation?: string;
  resourceId?: string;
  grantId?: string;
  grantRevision?: number;
  parentTaskJti?: string;
}

export interface CredentialVerificationOptions {
  issuer: string;
  jwksUrl?: string | URL;
  keyResolver?: JWTVerifyGetKey;
  algorithms?: string[];
  clockToleranceSeconds?: number;
  expected: CredentialBindingExpectation;
}

export interface VerifiedCredential<TClaims> {
  claims: TClaims;
  issuer: string;
  subject: string;
  expiresAt: Date;
  issuedAt: Date;
  jti: string;
  protectedHeader: { alg?: string; kid?: string };
}

function getResolver(options: CredentialVerificationOptions): JWTVerifyGetKey {
  if (options.keyResolver) return options.keyResolver;
  if (!options.jwksUrl) {
    throw new CredentialError(
      'credential_invalid',
      'A trusted JWKS URL or key resolver is required',
    );
  }
  return createRemoteJWKSet(new URL(options.jwksUrl), {
    timeoutDuration: 5_000,
    cacheMaxAge: 300_000,
    cooldownDuration: 30_000,
  });
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
  expected: CredentialBindingExpectation,
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
  expected: CredentialBindingExpectation,
): void {
  validateCommonTaskBindings(claims, expected);
  if (
    expected.runtimeKind !== undefined &&
    claims.runtimeKind !== expected.runtimeKind
  )
    mismatch('runtime kind');
  if (
    expected.capabilityManifestVersion !== undefined &&
    claims.capabilityManifestVersion !== expected.capabilityManifestVersion
  )
    mismatch('capability manifest');
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
  expected: CredentialBindingExpectation,
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
      algorithms: options.algorithms ?? ['EdDSA'],
      clockTolerance: options.clockToleranceSeconds ?? 5,
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
      validateTaskBindings(taskClaims, options.expected);
    } else {
      const connectorClaims = custom as ConnectorClaims;
      if (standard.subject !== connectorClaims.task.agentId)
        mismatch('subject');
      validateConnectorBindings(connectorClaims, options.expected);
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
    const code =
      error instanceof Error && error.name === 'JWTExpired'
        ? 'credential_expired'
        : 'credential_invalid';
    throw new CredentialError(code, 'Credential verification failed');
  }
}

export function parseCredentialPayload(token: string): JWTPayload {
  try {
    return decodeJwt(token);
  } catch {
    throw new CredentialError(
      'credential_invalid',
      'Credential is not a compact JWT',
    );
  }
}

export function verifyTaskCredential(
  token: string,
  options: CredentialVerificationOptions,
): Promise<VerifiedCredential<TaskClaims>> {
  return verify<TaskClaims>(token, 'task', options);
}

export function verifyConnectorCredential(
  token: string,
  options: CredentialVerificationOptions,
): Promise<VerifiedCredential<ConnectorClaims>> {
  return verify<ConnectorClaims>(token, 'connector', options);
}
