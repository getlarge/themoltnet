import { readExecutorManifestBinding } from '@moltnet/crypto-service';
import type {
  RuntimePolicySnapshotRepository,
  TaskRepository,
} from '@moltnet/database';
import { TOOL_ENFORCEMENT_VALUES, type ToolEnforcement } from '@moltnet/models';
import {
  canonicalEffectivePolicySnapshot,
  EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION,
  hashEffectivePolicySnapshot,
} from '@moltnet/runtime-policy-service';
import { RUNTIME_PROFILE_RUNTIME_KIND_REGEXP } from '@moltnet/tasks';
import type {
  TaskAuthorityDecision,
  TaskAuthorityProvider,
  TaskAuthorityRequest,
} from '@themoltnet/credential-broker';

import type { Logger } from './task-service.types.js';

export interface MoltNetTaskAuthorityProviderDeps {
  taskRepository: Pick<
    TaskRepository,
    'findById' | 'findAttempt' | 'findExecutorManifest'
  >;
  runtimePolicySnapshotRepository: RuntimePolicySnapshotRepository;
  logger: Pick<Logger, 'info' | 'warn'>;
  denialCounter: {
    add(value: number, attributes: { reason: string }): void;
  };
  now?: () => Date;
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
      const logLevel =
        reason === 'attempt_inactive' || reason === 'lease_inactive'
          ? 'info'
          : 'warn';
      deps.logger[logLevel](
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
        !attempt.policySnapshotHash ||
        !attempt.claimedExecutorFingerprint
      ) {
        return deny(request, 'authority_binding_missing');
      }

      const [snapshot, executor] = await Promise.all([
        deps.runtimePolicySnapshotRepository.findByHash(
          attempt.policySnapshotHash,
        ),
        deps.taskRepository.findExecutorManifest(
          attempt.claimedExecutorFingerprint,
        ),
      ]);
      if (!snapshot) return deny(request, 'policy_snapshot_missing');
      if (!executor) return deny(request, 'executor_manifest_missing');
      if (snapshot.schemaVersion !== EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION) {
        return deny(request, 'schema_version_mismatch');
      }
      if (
        !RUNTIME_PROFILE_RUNTIME_KIND_REGEXP.test(snapshot.runtimeKind) ||
        !isToolEnforcement(snapshot.enforcement)
      ) {
        return deny(request, 'authority_binding_invalid');
      }
      const canonical = canonicalEffectivePolicySnapshot({
        runtimeKind: snapshot.runtimeKind,
        enforcement: snapshot.enforcement,
        allowedTools: snapshot.allowedTools,
      });
      if (
        hashEffectivePolicySnapshot(canonical) !== snapshot.hash ||
        snapshot.hash !== attempt.policySnapshotHash
      ) {
        return deny(request, 'snapshot_hash_mismatch');
      }
      let manifestBinding;
      try {
        manifestBinding = readExecutorManifestBinding(executor.manifest);
      } catch {
        return deny(request, 'executor_binding_mismatch');
      }
      if (
        manifestBinding.profileId !== attempt.runtimeProfileId ||
        !manifestBinding.profileDefinitionCid ||
        manifestBinding.runtimeKind !== snapshot.runtimeKind
      ) {
        return deny(request, 'executor_binding_mismatch');
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
          runtimeKind: snapshot.runtimeKind,
          executorManifestFingerprint: attempt.claimedExecutorFingerprint,
          runtimeProfileId: attempt.runtimeProfileId,
          runtimeProfileRevision: attempt.runtimeProfileRevision,
          policySnapshotHash: attempt.policySnapshotHash,
        },
      };
    },
  };
}
