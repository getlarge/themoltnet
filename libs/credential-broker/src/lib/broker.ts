import {
  type ConnectorCredentialClaims,
  CREDENTIAL_CLAIM_NAMESPACE,
  CREDENTIAL_CONTRACT_VERSION,
  CredentialError,
  type CredentialEvidenceEvent,
  isConnectorCredentialClaims,
  isTaskCredentialClaims,
  type TaskCredentialClaims,
  type VerifiedCredential,
} from '@themoltnet/credentials';

export interface TaskAuthorityRequest {
  agentId: string;
  teamId: string;
  taskId: string;
  attemptN: number;
}

interface AuthorityDenial {
  allowed: false;
  reason: string;
}

export type TaskAuthorityDecision =
  | AuthorityDenial
  | {
      allowed: true;
      reason: string;
      leaseExpiresAt: Date;
      claims: Omit<TaskCredentialClaims, 'version' | 'kind'>;
    };

export interface ConnectorAuthorityRequest {
  task: TaskCredentialClaims;
  grantId: string;
  connectorId: string;
  operation: string;
  resourceId: string;
}

export type ConnectorAuthorityDecision =
  | AuthorityDenial
  | {
      allowed: true;
      reason: string;
      grantRevision: number;
      authorityExpiresAt?: Date;
    };

export interface TaskAuthorityProvider {
  authorizeTask(request: TaskAuthorityRequest): Promise<TaskAuthorityDecision>;
}

export interface ConnectorAuthorityProvider {
  authorizeConnector(
    request: ConnectorAuthorityRequest,
  ): Promise<ConnectorAuthorityDecision>;
}

export interface TaskCredentialBinding {
  agentId: string;
  teamId: string;
  taskId: string;
  attemptN: number;
}

export interface TaskCredentialVerifier {
  verify(
    token: string,
    expected: TaskCredentialBinding,
  ): Promise<VerifiedCredential<TaskCredentialClaims>>;
}

export interface DeriveTokenInput {
  parentCredential: string;
  customClaims: {
    [CREDENTIAL_CLAIM_NAMESPACE]:
      | TaskCredentialClaims
      | ConnectorCredentialClaims;
  };
  ttlSeconds: number;
  scopes: readonly string[];
}

export interface DerivedToken {
  token: string;
  expiresAt: Date;
  jti?: string;
  kid?: string;
}

export interface TokenDeriver {
  derive(input: DeriveTokenInput): Promise<DerivedToken>;
}

export interface EvidenceSink {
  emit(event: CredentialEvidenceEvent): Promise<void>;
}

export interface BrokerClock {
  now(): Date;
}

export interface CredentialBrokerOptions {
  taskAuthority?: TaskAuthorityProvider;
  connectorAuthority?: ConnectorAuthorityProvider;
  taskCredentialVerifier?: TaskCredentialVerifier;
  tokenDeriver: TokenDeriver;
  evidence: EvidenceSink;
  clock?: BrokerClock;
  taskTtlCeilingSeconds?: number;
  connectorTtlCeilingSeconds?: number;
}

export interface IssueTaskCredentialRequest extends TaskAuthorityRequest {
  agentCredential: string;
}

export interface IssueConnectorCredentialRequest {
  taskCredential: string;
  task: TaskCredentialBinding;
  grantId: string;
  connectorId: string;
  operation: string;
  resourceId: string;
}

export interface IssuedCredential<
  TClaims extends TaskCredentialClaims | ConnectorCredentialClaims,
> {
  token: string;
  expiresAt: Date;
  claims: TClaims;
}

export interface CredentialBroker {
  issueTaskCredential(
    request: IssueTaskCredentialRequest,
  ): Promise<IssuedCredential<TaskCredentialClaims>>;
  issueConnectorCredential(
    request: IssueConnectorCredentialRequest,
  ): Promise<IssuedCredential<ConnectorCredentialClaims>>;
}

export const DEFAULT_TASK_TTL_CEILING_SECONDS = 900;
export const DEFAULT_CONNECTOR_TTL_CEILING_SECONDS = 300;
export const TASK_CREDENTIAL_SCOPE = 'moltnet:task' as const;
export const CONNECTOR_CREDENTIAL_SCOPE = 'moltnet:connector' as const;
export const DERIVED_LIFETIME_SKEW_MS = 1_000;
export const MINIMUM_USABLE_DERIVED_LIFETIME_MS = 1_000;

const systemClock: BrokerClock = { now: () => new Date() };
const SAFE_REASON = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$/;

function safeReason(reason: string, fallback: string): string {
  return SAFE_REASON.test(reason) ? reason : fallback;
}

function ttlSeconds(now: Date, expiries: Date[], ceiling: number): number {
  const remaining = expiries.map((expiry) =>
    Math.floor((expiry.getTime() - now.getTime()) / 1_000),
  );
  const ttl = Math.min(ceiling, ...remaining);
  if (!Number.isSafeInteger(ttl) || ttl < 1) {
    throw new CredentialError(
      'ttl_exhausted',
      'Credential authority has no remaining lifetime',
    );
  }
  return ttl;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function evidenceBase(
  now: Date,
  event: CredentialEvidenceEvent['event'],
  outcome: CredentialEvidenceEvent['outcome'],
  reason: string,
): Pick<
  CredentialEvidenceEvent,
  'version' | 'event' | 'occurredAt' | 'outcome' | 'reason'
> {
  return {
    version: CREDENTIAL_CONTRACT_VERSION,
    event,
    occurredAt: now.toISOString(),
    outcome,
    reason,
  };
}

async function emitEvidence(
  evidence: EvidenceSink,
  event: CredentialEvidenceEvent,
  required: boolean,
): Promise<void> {
  try {
    await evidence.emit(event);
  } catch {
    if (required) {
      throw new CredentialError(
        'evidence_unavailable',
        'Credential evidence sink is unavailable',
      );
    }
  }
}

function credentialEvidenceBindings(derived: DerivedToken) {
  return {
    ...(derived.jti ? { credentialJti: derived.jti } : {}),
    ...(derived.kid ? { credentialKid: derived.kid } : {}),
  };
}

function canonicalTaskClaims(
  claims: Omit<TaskCredentialClaims, 'version' | 'kind'>,
): TaskCredentialClaims {
  const canonical: TaskCredentialClaims = {
    version: CREDENTIAL_CONTRACT_VERSION,
    kind: 'task',
    agentId: claims.agentId,
    teamId: claims.teamId,
    taskId: claims.taskId,
    attemptN: claims.attemptN,
    leaseId: claims.leaseId,
    runtimeKind: claims.runtimeKind,
    executorManifestFingerprint: claims.executorManifestFingerprint,
    runtimeProfileId: claims.runtimeProfileId,
    runtimeProfileRevision: claims.runtimeProfileRevision,
    policySnapshotHash: claims.policySnapshotHash,
  };
  if (!isTaskCredentialClaims(canonical)) {
    throw new CredentialError(
      'authority_denied',
      'Task authority returned an invalid canonical decision',
    );
  }
  return canonical;
}

function assertTaskAuthorityBinding(
  claims: TaskCredentialClaims,
  request: TaskAuthorityRequest,
): void {
  if (
    claims.agentId !== request.agentId ||
    claims.teamId !== request.teamId ||
    claims.taskId !== request.taskId ||
    claims.attemptN !== request.attemptN
  ) {
    throw new CredentialError(
      'authority_denied',
      'Task authority returned a mismatched binding',
    );
  }
}

function canonicalConnectorClaims(input: {
  task: TaskCredentialClaims;
  taskJti: string;
  grantId: string;
  grantRevision: number;
  connectorId: string;
  operation: string;
  resourceId: string;
}): ConnectorCredentialClaims {
  const canonical: ConnectorCredentialClaims = {
    version: CREDENTIAL_CONTRACT_VERSION,
    kind: 'connector',
    task: {
      agentId: input.task.agentId,
      teamId: input.task.teamId,
      taskId: input.task.taskId,
      attemptN: input.task.attemptN,
      leaseId: input.task.leaseId,
    },
    grantId: input.grantId,
    grantRevision: input.grantRevision,
    connectorId: input.connectorId,
    operation: input.operation,
    resourceId: input.resourceId,
    parentTaskJti: input.taskJti,
  };
  if (!isConnectorCredentialClaims(canonical)) {
    throw new CredentialError(
      'authority_denied',
      'Connector authority returned an invalid canonical decision',
    );
  }
  return canonical;
}

function taskEvidenceBindings(claims: TaskCredentialClaims) {
  return {
    agentId: claims.agentId,
    teamId: claims.teamId,
    taskId: claims.taskId,
    attemptN: claims.attemptN,
  };
}

function validateVerifiedTask(
  verified: VerifiedCredential<TaskCredentialClaims>,
  expected: TaskCredentialBinding,
): void {
  if (
    !isTaskCredentialClaims(verified.claims) ||
    typeof verified.jti !== 'string' ||
    verified.jti.length === 0 ||
    !(verified.expiresAt instanceof Date) ||
    Number.isNaN(verified.expiresAt.getTime())
  ) {
    throw new CredentialError(
      'credential_invalid',
      'Task credential verifier returned an invalid result',
    );
  }
  if (
    verified.claims.agentId !== expected.agentId ||
    verified.claims.teamId !== expected.teamId ||
    verified.claims.taskId !== expected.taskId ||
    verified.claims.attemptN !== expected.attemptN
  ) {
    throw new CredentialError(
      'credential_binding_mismatch',
      'Task credential verifier returned a mismatched binding',
    );
  }
}

function validateDerivedLifetime(
  derived: DerivedToken,
  comparisonTime: Date,
  ttl: number,
): void {
  if (
    typeof derived.token !== 'string' ||
    derived.token.length === 0 ||
    !isValidDate(derived.expiresAt) ||
    (derived.jti !== undefined &&
      (typeof derived.jti !== 'string' || derived.jti.length === 0)) ||
    (derived.kid !== undefined &&
      (typeof derived.kid !== 'string' || derived.kid.length === 0))
  ) {
    throw new CredentialError(
      'derivation_failed',
      'Credential derivation returned an invalid result',
    );
  }
  const remainingMs = derived.expiresAt.getTime() - comparisonTime.getTime();
  if (
    !Number.isFinite(remainingMs) ||
    remainingMs < MINIMUM_USABLE_DERIVED_LIFETIME_MS ||
    remainingMs > ttl * 1_000 + DERIVED_LIFETIME_SKEW_MS
  ) {
    throw new CredentialError(
      'derivation_failed',
      'Derived credential lifetime exceeds its authority',
    );
  }
}

export function createCredentialBroker(
  options: CredentialBrokerOptions,
): CredentialBroker {
  const clock = options.clock ?? systemClock;
  const evidence = options.evidence;

  return {
    async issueTaskCredential(
      request: IssueTaskCredentialRequest,
    ): Promise<IssuedCredential<TaskCredentialClaims>> {
      if (!options.taskAuthority) {
        throw new CredentialError(
          'authority_unavailable',
          'Task authority provider is not configured',
        );
      }
      const authorityRequest: TaskAuthorityRequest = {
        agentId: request.agentId,
        teamId: request.teamId,
        taskId: request.taskId,
        attemptN: request.attemptN,
      };
      let decision: TaskAuthorityDecision;
      try {
        decision = await options.taskAuthority.authorizeTask(authorityRequest);
      } catch {
        await emitEvidence(
          evidence,
          {
            ...evidenceBase(
              clock.now(),
              'task_credential_denied',
              'deny',
              'authority_unavailable',
            ),
            agentId: request.agentId,
            teamId: request.teamId,
            taskId: request.taskId,
            attemptN: request.attemptN,
          },
          false,
        );
        throw new CredentialError(
          'authority_unavailable',
          'Task authority is unavailable',
        );
      }
      if (!decision.allowed) {
        await emitEvidence(
          evidence,
          {
            ...evidenceBase(
              clock.now(),
              'task_credential_denied',
              'deny',
              safeReason(decision.reason, 'authority_denied'),
            ),
            agentId: request.agentId,
            teamId: request.teamId,
            taskId: request.taskId,
            attemptN: request.attemptN,
          },
          false,
        );
        throw new CredentialError('authority_denied', 'Task authority denied');
      }
      let claims: TaskCredentialClaims;
      try {
        claims = canonicalTaskClaims(decision.claims);
        assertTaskAuthorityBinding(claims, authorityRequest);
        if (!isValidDate(decision.leaseExpiresAt)) {
          throw new CredentialError(
            'authority_denied',
            'Task authority returned an invalid lease expiry',
          );
        }
      } catch {
        await emitEvidence(
          evidence,
          {
            ...evidenceBase(
              clock.now(),
              'task_credential_denied',
              'deny',
              'authority_invalid',
            ),
            agentId: request.agentId,
            teamId: request.teamId,
            taskId: request.taskId,
            attemptN: request.attemptN,
          },
          false,
        );
        throw new CredentialError(
          'authority_denied',
          'Task authority returned an invalid decision',
        );
      }
      const authorityTime = clock.now();
      const ttl = ttlSeconds(
        authorityTime,
        [decision.leaseExpiresAt],
        options.taskTtlCeilingSeconds ?? DEFAULT_TASK_TTL_CEILING_SECONDS,
      );
      let derived: DerivedToken;
      try {
        derived = await options.tokenDeriver.derive({
          parentCredential: request.agentCredential,
          customClaims: { [CREDENTIAL_CLAIM_NAMESPACE]: claims },
          ttlSeconds: ttl,
          scopes: [TASK_CREDENTIAL_SCOPE],
        });
        validateDerivedLifetime(derived, clock.now(), ttl);
      } catch (error) {
        await emitEvidence(
          evidence,
          {
            ...evidenceBase(
              clock.now(),
              'task_credential_denied',
              'deny',
              error instanceof CredentialError
                ? error.code
                : 'derivation_failed',
            ),
            ...taskEvidenceBindings(claims),
          },
          false,
        );
        if (error instanceof CredentialError) throw error;
        throw new CredentialError(
          'derivation_failed',
          'Credential derivation failed',
        );
      }
      await emitEvidence(
        evidence,
        {
          ...evidenceBase(
            clock.now(),
            'task_credential_issued',
            'allow',
            'issued',
          ),
          ...taskEvidenceBindings(claims),
          ...credentialEvidenceBindings(derived),
        },
        true,
      );
      return { ...derived, claims };
    },

    async issueConnectorCredential(
      request: IssueConnectorCredentialRequest,
    ): Promise<IssuedCredential<ConnectorCredentialClaims>> {
      if (!options.connectorAuthority) {
        throw new CredentialError(
          'authority_unavailable',
          'Connector authority provider is not configured',
        );
      }
      if (!options.taskCredentialVerifier) {
        throw new CredentialError(
          'authority_unavailable',
          'Task credential verifier is not configured',
        );
      }
      let verifiedTask: VerifiedCredential<TaskCredentialClaims>;
      try {
        verifiedTask = await options.taskCredentialVerifier.verify(
          request.taskCredential,
          request.task,
        );
      } catch (error) {
        const credentialError =
          error instanceof CredentialError
            ? error
            : new CredentialError(
                'credential_invalid',
                'Task credential verification failed',
              );
        await emitEvidence(
          evidence,
          {
            ...evidenceBase(
              clock.now(),
              'connector_credential_denied',
              'deny',
              credentialError.code,
            ),
            ...request.task,
            connectorId: request.connectorId,
            operation: request.operation,
            resourceId: request.resourceId,
            grantId: request.grantId,
          },
          false,
        );
        throw credentialError;
      }
      try {
        validateVerifiedTask(verifiedTask, request.task);
      } catch (error) {
        await emitEvidence(
          evidence,
          {
            ...evidenceBase(
              clock.now(),
              'connector_credential_denied',
              'deny',
              error instanceof CredentialError
                ? error.code
                : 'credential_invalid',
            ),
            ...request.task,
            connectorId: request.connectorId,
            operation: request.operation,
            resourceId: request.resourceId,
            grantId: request.grantId,
          },
          false,
        );
        throw error;
      }
      const authorityRequest: ConnectorAuthorityRequest = {
        task: verifiedTask.claims,
        grantId: request.grantId,
        connectorId: request.connectorId,
        operation: request.operation,
        resourceId: request.resourceId,
      };
      let decision: ConnectorAuthorityDecision;
      try {
        decision =
          await options.connectorAuthority.authorizeConnector(authorityRequest);
      } catch {
        await emitEvidence(
          evidence,
          {
            ...evidenceBase(
              clock.now(),
              'connector_credential_denied',
              'deny',
              'authority_unavailable',
            ),
            ...taskEvidenceBindings(verifiedTask.claims),
            connectorId: request.connectorId,
            operation: request.operation,
            resourceId: request.resourceId,
            grantId: request.grantId,
          },
          false,
        );
        throw new CredentialError(
          'authority_unavailable',
          'Connector authority is unavailable',
        );
      }
      if (!decision.allowed) {
        await emitEvidence(
          evidence,
          {
            ...evidenceBase(
              clock.now(),
              'connector_credential_denied',
              'deny',
              safeReason(decision.reason, 'authority_denied'),
            ),
            ...taskEvidenceBindings(verifiedTask.claims),
            connectorId: request.connectorId,
            operation: request.operation,
            resourceId: request.resourceId,
            grantId: request.grantId,
          },
          false,
        );
        throw new CredentialError(
          'authority_denied',
          'Connector authority denied',
        );
      }
      let claims: ConnectorCredentialClaims;
      try {
        claims = canonicalConnectorClaims({
          task: verifiedTask.claims,
          taskJti: verifiedTask.jti,
          grantId: request.grantId,
          grantRevision: decision.grantRevision,
          connectorId: request.connectorId,
          operation: request.operation,
          resourceId: request.resourceId,
        });
        if (
          decision.authorityExpiresAt !== undefined &&
          !isValidDate(decision.authorityExpiresAt)
        ) {
          throw new CredentialError(
            'authority_denied',
            'Connector authority returned an invalid expiry',
          );
        }
      } catch {
        await emitEvidence(
          evidence,
          {
            ...evidenceBase(
              clock.now(),
              'connector_credential_denied',
              'deny',
              'authority_invalid',
            ),
            ...taskEvidenceBindings(verifiedTask.claims),
            connectorId: request.connectorId,
            operation: request.operation,
            resourceId: request.resourceId,
            grantId: request.grantId,
          },
          false,
        );
        throw new CredentialError(
          'authority_denied',
          'Connector authority returned an invalid decision',
        );
      }
      const expiries = [verifiedTask.expiresAt];
      if (decision.authorityExpiresAt) {
        expiries.push(decision.authorityExpiresAt);
      }
      const authorityTime = clock.now();
      const ttl = ttlSeconds(
        authorityTime,
        expiries,
        options.connectorTtlCeilingSeconds ??
          DEFAULT_CONNECTOR_TTL_CEILING_SECONDS,
      );
      let derived: DerivedToken;
      try {
        derived = await options.tokenDeriver.derive({
          parentCredential: request.taskCredential,
          customClaims: { [CREDENTIAL_CLAIM_NAMESPACE]: claims },
          ttlSeconds: ttl,
          scopes: [CONNECTOR_CREDENTIAL_SCOPE],
        });
        validateDerivedLifetime(derived, clock.now(), ttl);
      } catch (error) {
        await emitEvidence(
          evidence,
          {
            ...evidenceBase(
              clock.now(),
              'connector_credential_denied',
              'deny',
              error instanceof CredentialError
                ? error.code
                : 'derivation_failed',
            ),
            ...taskEvidenceBindings(verifiedTask.claims),
            connectorId: claims.connectorId,
            operation: claims.operation,
            resourceId: claims.resourceId,
            grantId: claims.grantId,
            grantRevision: claims.grantRevision,
          },
          false,
        );
        if (error instanceof CredentialError) throw error;
        throw new CredentialError(
          'derivation_failed',
          'Credential derivation failed',
        );
      }
      await emitEvidence(
        evidence,
        {
          ...evidenceBase(
            clock.now(),
            'connector_credential_issued',
            'allow',
            'issued',
          ),
          ...taskEvidenceBindings(verifiedTask.claims),
          connectorId: claims.connectorId,
          operation: claims.operation,
          resourceId: claims.resourceId,
          grantId: claims.grantId,
          grantRevision: claims.grantRevision,
          ...credentialEvidenceBindings(derived),
        },
        true,
      );
      return { ...derived, claims };
    },
  };
}
