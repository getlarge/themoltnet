import { readExecutorManifestBinding } from '@moltnet/crypto-service';
import type {
  RuntimePolicySnapshot,
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
  grantedCounter: {
    add(value: number, attributes: { runtimeKind: string }): void;
  };
  snapshotCacheMaxEntries?: number;
  now?: () => Date;
}

interface VerifiedSnapshotAuthority {
  runtimeKind: string;
  enforcement: ToolEnforcement;
}

const DEFAULT_SNAPSHOT_CACHE_MAX_ENTRIES = 256;

function isToolEnforcement(value: string): value is ToolEnforcement {
  return (TOOL_ENFORCEMENT_VALUES as readonly string[]).includes(value);
}

export function createMoltNetTaskAuthorityProvider(
  deps: MoltNetTaskAuthorityProviderDeps,
): TaskAuthorityProvider {
  const now = deps.now ?? (() => new Date());
  const snapshotCacheMaxEntries =
    Number.isInteger(deps.snapshotCacheMaxEntries) &&
    (deps.snapshotCacheMaxEntries ?? 0) > 0
      ? (deps.snapshotCacheMaxEntries as number)
      : DEFAULT_SNAPSHOT_CACHE_MAX_ENTRIES;
  const verifiedSnapshotCache = new Map<string, VerifiedSnapshotAuthority>();
  const readVerifiedSnapshot = (
    hash: string,
  ): VerifiedSnapshotAuthority | undefined => {
    const cached = verifiedSnapshotCache.get(hash);
    if (!cached) return undefined;
    verifiedSnapshotCache.delete(hash);
    verifiedSnapshotCache.set(hash, cached);
    return cached;
  };
  const cacheVerifiedSnapshot = (
    hash: string,
    authority: VerifiedSnapshotAuthority,
  ): void => {
    verifiedSnapshotCache.delete(hash);
    verifiedSnapshotCache.set(hash, authority);
    if (verifiedSnapshotCache.size <= snapshotCacheMaxEntries) return;
    const oldestHash = verifiedSnapshotCache.keys().next().value;
    if (oldestHash !== undefined) verifiedSnapshotCache.delete(oldestHash);
  };
  const verifySnapshot = (
    snapshot: RuntimePolicySnapshot,
    expectedHash: string,
  ): { authority: VerifiedSnapshotAuthority } | { reason: string } => {
    if (snapshot.schemaVersion !== EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION) {
      return { reason: 'schema_version_mismatch' };
    }
    if (
      !RUNTIME_PROFILE_RUNTIME_KIND_REGEXP.test(snapshot.runtimeKind) ||
      !isToolEnforcement(snapshot.enforcement)
    ) {
      return { reason: 'authority_binding_invalid' };
    }
    let canonical;
    try {
      canonical = canonicalEffectivePolicySnapshot({
        runtimeKind: snapshot.runtimeKind,
        enforcement: snapshot.enforcement,
        allowedTools: snapshot.allowedTools,
        allowedShellCommands: snapshot.allowedShellCommands,
      });
    } catch {
      return { reason: 'authority_binding_invalid' };
    }
    if (
      hashEffectivePolicySnapshot(canonical) !== snapshot.hash ||
      snapshot.hash !== expectedHash
    ) {
      return { reason: 'snapshot_hash_mismatch' };
    }
    return {
      authority: {
        runtimeKind: snapshot.runtimeKind,
        enforcement: snapshot.enforcement,
      },
    };
  };
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

      let snapshotAuthority = readVerifiedSnapshot(attempt.policySnapshotHash);
      const [snapshot, executor] = await Promise.all([
        snapshotAuthority
          ? Promise.resolve(null)
          : deps.runtimePolicySnapshotRepository.findByHash(
              attempt.policySnapshotHash,
            ),
        deps.taskRepository.findExecutorManifest(
          attempt.claimedExecutorFingerprint,
        ),
      ]);
      if (!executor) return deny(request, 'executor_manifest_missing');
      if (!snapshotAuthority) {
        if (!snapshot) return deny(request, 'policy_snapshot_missing');
        const verification = verifySnapshot(
          snapshot,
          attempt.policySnapshotHash,
        );
        if ('reason' in verification) {
          return deny(request, verification.reason);
        }
        snapshotAuthority = verification.authority;
        cacheVerifiedSnapshot(attempt.policySnapshotHash, snapshotAuthority);
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
        manifestBinding.runtimeKind !== snapshotAuthority.runtimeKind
      ) {
        return deny(request, 'executor_binding_mismatch');
      }

      const decision: TaskAuthorityDecision = {
        allowed: true,
        reason: 'active_pinned_authority',
        leaseExpiresAt: task.claimExpiresAt,
        claims: {
          agentId: request.agentId,
          teamId: request.teamId,
          taskId: request.taskId,
          attemptN: request.attemptN,
          leaseId: attempt.leaseId,
          runtimeKind: snapshotAuthority.runtimeKind,
          executorManifestFingerprint: attempt.claimedExecutorFingerprint,
          runtimeProfileId: attempt.runtimeProfileId,
          runtimeProfileRevision: attempt.runtimeProfileRevision,
          policySnapshotHash: attempt.policySnapshotHash,
        },
      };
      try {
        deps.logger.info(
          {
            reason: decision.reason,
            taskId: request.taskId,
            attemptN: request.attemptN,
            agentId: request.agentId,
            teamId: request.teamId,
            leaseId: attempt.leaseId,
            policySnapshotHash: attempt.policySnapshotHash,
            runtimeKind: snapshotAuthority.runtimeKind,
            executorManifestFingerprint: attempt.claimedExecutorFingerprint,
          },
          'Task authority granted',
        );
      } catch {
        // Authorization must remain available if telemetry is unavailable.
      }
      try {
        deps.grantedCounter.add(1, {
          runtimeKind: snapshotAuthority.runtimeKind,
        });
      } catch {
        // Authorization must remain available if telemetry is unavailable.
      }
      return decision;
    },
  };
}
