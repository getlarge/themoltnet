import type {
  RuntimePolicySnapshotRepository,
  TaskRepository,
} from '@moltnet/database';
import {
  findUnavailableRuntimeCapabilities,
  GONDOLIN_PI_RUNTIME_KIND,
  RUNTIME_KINDS,
  type RuntimeKind,
  TOOL_ENFORCEMENT_VALUES,
  type ToolEnforcement,
} from '@moltnet/models';
import {
  canonicalEffectivePolicySnapshot,
  EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION,
  hashEffectivePolicySnapshot,
} from '@moltnet/runtime-policy-service';
import type {
  TaskAuthorityDecision,
  TaskAuthorityProvider,
  TaskAuthorityRequest,
} from '@themoltnet/credential-broker';

export interface MoltNetTaskAuthorityProviderDeps {
  taskRepository: Pick<TaskRepository, 'findById' | 'findAttempt'>;
  runtimePolicySnapshotRepository: RuntimePolicySnapshotRepository;
  logger: {
    warn(context: Record<string, unknown>, message: string): void;
  };
  denialCounter: {
    add(value: number, attributes: { reason: string }): void;
  };
  now?: () => Date;
}

function isRuntimeKind(value: string): value is RuntimeKind {
  return (RUNTIME_KINDS as readonly string[]).includes(value);
}

function isToolEnforcement(value: string): value is ToolEnforcement {
  return (TOOL_ENFORCEMENT_VALUES as readonly string[]).includes(value);
}

export function createMoltNetTaskAuthorityProvider(
  deps: MoltNetTaskAuthorityProviderDeps,
): TaskAuthorityProvider {
  const now = deps.now ?? (() => new Date());
  const deny = (
    request: TaskAuthorityRequest,
    reason: string,
  ): TaskAuthorityDecision => {
    try {
      deps.logger.warn(
        {
          reason,
          taskId: request.taskId,
          attemptN: request.attemptN,
          agentId: request.agentId,
          teamId: request.teamId,
        },
        'Task authority denied',
      );
    } catch {
      // Authorization must remain fail-closed if telemetry is unavailable.
    }
    try {
      deps.denialCounter.add(1, { reason });
    } catch {
      // Authorization must remain fail-closed if telemetry is unavailable.
    }
    return { allowed: false, reason };
  };

  return {
    async authorizeTask(
      request: TaskAuthorityRequest,
    ): Promise<TaskAuthorityDecision> {
      const [task, attempt] = await Promise.all([
        deps.taskRepository.findById(request.taskId),
        deps.taskRepository.findAttempt(request.taskId, request.attemptN),
      ]);
      if (!task || !attempt) {
        return deny(request, 'task_attempt_not_found');
      }
      if (task.teamId !== request.teamId) {
        return deny(request, 'team_mismatch');
      }
      if (
        attempt.claimedByAgentId !== request.agentId ||
        task.claimAgentId !== request.agentId
      ) {
        return deny(request, 'claimant_mismatch');
      }
      if (attempt.status !== 'claimed' && attempt.status !== 'running') {
        return deny(request, 'attempt_inactive');
      }
      if (
        (task.status !== 'dispatched' && task.status !== 'running') ||
        !task.claimExpiresAt ||
        task.claimExpiresAt.getTime() <= now().getTime()
      ) {
        return deny(request, 'lease_inactive');
      }
      if (
        !attempt.leaseId ||
        !attempt.runtimeProfileId ||
        !attempt.runtimeProfileRevision ||
        !attempt.policySnapshotHash
      ) {
        return deny(request, 'authority_binding_missing');
      }

      const snapshot = await deps.runtimePolicySnapshotRepository.findByHash(
        attempt.policySnapshotHash,
      );
      if (!snapshot) return deny(request, 'policy_snapshot_missing');
      if (snapshot.schemaVersion !== EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION) {
        return deny(request, 'schema_version_mismatch');
      }
      if (
        !isRuntimeKind(snapshot.runtimeKind) ||
        !isToolEnforcement(snapshot.enforcement)
      ) {
        return deny(request, 'authority_binding_invalid');
      }
      if (
        findUnavailableRuntimeCapabilities(
          snapshot.runtimeKind,
          snapshot.allowedTools,
        ).length > 0
      ) {
        return deny(request, 'authority_binding_invalid');
      }
      const canonical = canonicalEffectivePolicySnapshot({
        runtimeKind: snapshot.runtimeKind,
        enforcement: snapshot.enforcement,
        allowedTools: snapshot.allowedTools,
      });
      if (
        canonical.capabilityManifestVersion !==
        snapshot.capabilityManifestVersion
      ) {
        return deny(request, 'manifest_version_superseded');
      }
      if (
        hashEffectivePolicySnapshot(canonical) !== snapshot.hash ||
        snapshot.hash !== attempt.policySnapshotHash
      ) {
        return deny(request, 'snapshot_hash_mismatch');
      }

      return {
        allowed: true,
        reason: 'active_pinned_authority',
        leaseExpiresAt: task.claimExpiresAt,
        claims: {
          agentId: request.agentId,
          teamId: request.teamId,
          taskId: request.taskId,
          attemptN: request.attemptN,
          leaseId: attempt.leaseId,
          runtimeKind: GONDOLIN_PI_RUNTIME_KIND,
          capabilityManifestVersion: snapshot.capabilityManifestVersion,
          runtimeProfileId: attempt.runtimeProfileId,
          runtimeProfileRevision: attempt.runtimeProfileRevision,
          policySnapshotHash: attempt.policySnapshotHash,
        },
      };
    },
  };
}
