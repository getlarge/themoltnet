import {
  type ConnectorCredentialClaims,
  CREDENTIAL_CLAIM_NAMESPACE,
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
  evidence?: EvidenceSink;
  clock?: BrokerClock;
  taskTtlCeilingSeconds?: number;
  connectorTtlCeilingSeconds?: number;
}

export interface IssuedCredential {
  token: string;
  expiresAt: Date;
  binding: TaskCredentialClaims | ConnectorCredentialClaims;
}

const noopEvidence: EvidenceSink = { emit: async () => undefined };
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
    version: 1,
    event,
    occurredAt: now.toISOString(),
    outcome,
    reason,
  };
}

function canonicalTaskClaims(
  claims: Omit<TaskCredentialClaims, 'version' | 'kind'>,
): TaskCredentialClaims {
  const canonical: TaskCredentialClaims = {
    version: 1,
    kind: 'task',
    agentId: claims.agentId,
    teamId: claims.teamId,
    taskId: claims.taskId,
    attemptN: claims.attemptN,
    leaseId: claims.leaseId,
    runtimeKind: claims.runtimeKind,
    capabilityManifestVersion: claims.capabilityManifestVersion,
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
    version: 1,
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
  now: Date,
  ttl: number,
): void {
  if (
    typeof derived.token !== 'string' ||
    derived.token.length === 0 ||
    !(derived.expiresAt instanceof Date)
  ) {
    throw new CredentialError(
      'derivation_failed',
      'Credential derivation returned an invalid result',
    );
  }
  const remainingMs = derived.expiresAt.getTime() - now.getTime();
  if (
    !Number.isFinite(remainingMs) ||
    remainingMs < 1_000 ||
    remainingMs > ttl * 1_000 + 1_000
  ) {
    throw new CredentialError(
      'derivation_failed',
      'Derived credential lifetime exceeds its authority',
    );
  }
}

export function createCredentialBroker(options: CredentialBrokerOptions) {
  const clock = options.clock ?? systemClock;
  const evidence = options.evidence ?? noopEvidence;

  return {
    async issueTaskCredential(
      request: TaskAuthorityRequest & { agentCredential: string },
    ): Promise<IssuedCredential> {
      const now = clock.now();
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
        await evidence.emit({
          ...evidenceBase(
            now,
            'task_credential_denied',
            'deny',
            'authority_unavailable',
          ),
          agentId: request.agentId,
          teamId: request.teamId,
          taskId: request.taskId,
          attemptN: request.attemptN,
        });
        throw new CredentialError(
          'authority_unavailable',
          'Task authority is unavailable',
        );
      }
      if (!decision.allowed) {
        await evidence.emit({
          ...evidenceBase(
            now,
            'task_credential_denied',
            'deny',
            safeReason(decision.reason, 'authority_denied'),
          ),
          agentId: request.agentId,
          teamId: request.teamId,
          taskId: request.taskId,
          attemptN: request.attemptN,
        });
        throw new CredentialError('authority_denied', 'Task authority denied');
      }
      let binding: TaskCredentialClaims;
      try {
        binding = canonicalTaskClaims(decision.claims);
        assertTaskAuthorityBinding(binding, authorityRequest);
      } catch {
        await evidence.emit({
          ...evidenceBase(
            now,
            'task_credential_denied',
            'deny',
            'authority_invalid',
          ),
          agentId: request.agentId,
          teamId: request.teamId,
          taskId: request.taskId,
          attemptN: request.attemptN,
        });
        throw new CredentialError(
          'authority_denied',
          'Task authority returned an invalid decision',
        );
      }
      const ttl = ttlSeconds(
        now,
        [decision.leaseExpiresAt],
        options.taskTtlCeilingSeconds ?? 900,
      );
      const derived = await options.tokenDeriver.derive({
        parentCredential: request.agentCredential,
        customClaims: { [CREDENTIAL_CLAIM_NAMESPACE]: binding },
        ttlSeconds: ttl,
        scopes: ['moltnet:task'],
      });
      validateDerivedLifetime(derived, now, ttl);
      await evidence.emit({
        ...evidenceBase(now, 'task_credential_issued', 'allow', 'issued'),
        agentId: binding.agentId,
        teamId: binding.teamId,
        taskId: binding.taskId,
        attemptN: binding.attemptN,
      });
      return { ...derived, binding };
    },

    async issueConnectorCredential(request: {
      taskCredential: string;
      task: TaskCredentialBinding;
      grantId: string;
      connectorId: string;
      operation: string;
      resourceId: string;
    }): Promise<IssuedCredential> {
      const now = clock.now();
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
        if (error instanceof CredentialError) throw error;
        throw new CredentialError(
          'credential_invalid',
          'Task credential verification failed',
        );
      }
      validateVerifiedTask(verifiedTask, request.task);
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
        await evidence.emit({
          ...evidenceBase(
            now,
            'connector_credential_denied',
            'deny',
            'authority_unavailable',
          ),
          ...taskEvidenceBindings(verifiedTask.claims),
          connectorId: request.connectorId,
          operation: request.operation,
          resourceId: request.resourceId,
          grantId: request.grantId,
        });
        throw new CredentialError(
          'authority_unavailable',
          'Connector authority is unavailable',
        );
      }
      if (!decision.allowed) {
        await evidence.emit({
          ...evidenceBase(
            now,
            'connector_credential_denied',
            'deny',
            safeReason(decision.reason, 'authority_denied'),
          ),
          ...taskEvidenceBindings(verifiedTask.claims),
          connectorId: request.connectorId,
          operation: request.operation,
          resourceId: request.resourceId,
          grantId: request.grantId,
        });
        throw new CredentialError(
          'authority_denied',
          'Connector authority denied',
        );
      }
      let binding: ConnectorCredentialClaims;
      try {
        binding = canonicalConnectorClaims({
          task: verifiedTask.claims,
          taskJti: verifiedTask.jti,
          grantId: request.grantId,
          grantRevision: decision.grantRevision,
          connectorId: request.connectorId,
          operation: request.operation,
          resourceId: request.resourceId,
        });
      } catch {
        await evidence.emit({
          ...evidenceBase(
            now,
            'connector_credential_denied',
            'deny',
            'authority_invalid',
          ),
          ...taskEvidenceBindings(verifiedTask.claims),
          connectorId: request.connectorId,
          operation: request.operation,
          resourceId: request.resourceId,
          grantId: request.grantId,
        });
        throw new CredentialError(
          'authority_denied',
          'Connector authority returned an invalid decision',
        );
      }
      const expiries = [verifiedTask.expiresAt];
      if (decision.authorityExpiresAt) {
        expiries.push(decision.authorityExpiresAt);
      }
      const ttl = ttlSeconds(
        now,
        expiries,
        options.connectorTtlCeilingSeconds ?? 300,
      );
      const derived = await options.tokenDeriver.derive({
        parentCredential: request.taskCredential,
        customClaims: { [CREDENTIAL_CLAIM_NAMESPACE]: binding },
        ttlSeconds: ttl,
        scopes: ['moltnet:connector'],
      });
      validateDerivedLifetime(derived, now, ttl);
      await evidence.emit({
        ...evidenceBase(now, 'connector_credential_issued', 'allow', 'issued'),
        ...taskEvidenceBindings(verifiedTask.claims),
        connectorId: binding.connectorId,
        operation: binding.operation,
        resourceId: binding.resourceId,
        grantId: binding.grantId,
        grantRevision: binding.grantRevision,
      });
      return { ...derived, binding };
    },
  };
}
