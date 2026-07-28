import type {
  RuntimePolicySnapshotRepository,
  TaskRepository,
} from '@moltnet/database';
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
  now?: () => Date;
}

const deny = (reason: string): TaskAuthorityDecision => ({
  allowed: false,
  reason,
});

export function createMoltNetTaskAuthorityProvider(
  deps: MoltNetTaskAuthorityProviderDeps,
): TaskAuthorityProvider {
  const now = deps.now ?? (() => new Date());

  return {
    async authorizeTask(
      request: TaskAuthorityRequest,
    ): Promise<TaskAuthorityDecision> {
      const [task, attempt] = await Promise.all([
        deps.taskRepository.findById(request.taskId),
        deps.taskRepository.findAttempt(request.taskId, request.attemptN),
      ]);
      if (!task || !attempt) return deny('task_attempt_not_found');
      if (task.teamId !== request.teamId) return deny('team_mismatch');
      if (
        attempt.claimedByAgentId !== request.agentId ||
        task.claimAgentId !== request.agentId
      ) {
        return deny('claimant_mismatch');
      }
      if (
        (task.status !== 'dispatched' && task.status !== 'running') ||
        !task.claimExpiresAt ||
        task.claimExpiresAt.getTime() <= now().getTime()
      ) {
        return deny('lease_inactive');
      }
      if (
        !attempt.leaseId ||
        !attempt.runtimeProfileId ||
        !attempt.runtimeProfileRevision ||
        !attempt.policySnapshotHash
      ) {
        return deny('authority_binding_missing');
      }

      const snapshot = await deps.runtimePolicySnapshotRepository.findByHash(
        attempt.policySnapshotHash,
      );
      if (!snapshot) return deny('policy_snapshot_missing');
      if (
        snapshot.schemaVersion !== EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION ||
        snapshot.runtimeKind !== 'gondolin_pi' ||
        !['off', 'watch', 'enforce'].includes(snapshot.enforcement)
      ) {
        return deny('authority_binding_inconsistent');
      }
      const canonical = canonicalEffectivePolicySnapshot({
        runtimeKind: snapshot.runtimeKind as 'gondolin_pi',
        enforcement: snapshot.enforcement as 'off' | 'watch' | 'enforce',
        allowedTools: snapshot.allowedTools,
      });
      if (
        canonical.capabilityManifestVersion !==
          snapshot.capabilityManifestVersion ||
        hashEffectivePolicySnapshot(canonical) !== snapshot.hash ||
        snapshot.hash !== attempt.policySnapshotHash
      ) {
        return deny('authority_binding_inconsistent');
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
          capabilityManifestVersion: snapshot.capabilityManifestVersion,
          runtimeProfileId: attempt.runtimeProfileId,
          runtimeProfileRevision: attempt.runtimeProfileRevision,
          policySnapshotHash: attempt.policySnapshotHash,
        },
      };
    },
  };
}
