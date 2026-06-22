import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

import type { Agent } from '@themoltnet/sdk';

import type { DaemonSlotIdentity } from './daemon-slot-identity.js';
import type {
  DaemonRuntimeSlotStore,
  ResolvedDaemonRuntimeSlotContext,
} from './execution-plan-cache.js';

export function resolveDaemonRuntimeId(
  stateRootDir: string,
  configuredId?: string,
): string {
  const configured = configuredId?.trim();
  if (configured) return configured.slice(0, 200);
  const rootHash = createHash('sha256')
    .update(stateRootDir)
    .digest('hex')
    .slice(0, 16);
  return `${hostname()}:${process.pid}:${rootHash}`.slice(0, 200);
}

export function createApiDaemonRuntimeSlotStore(args: {
  agent: Agent;
  daemonId: string;
  daemonProfileId?: string | null;
}): DaemonRuntimeSlotStore {
  const { agent, daemonId, daemonProfileId } = args;

  return {
    async beginSlot(input) {
      await agent.daemonRuntimeSlots.begin({
        agentName: input.agentName,
        daemonId,
        daemonProfileId: daemonProfileId ?? undefined,
        lastAttemptN: input.lastAttemptN,
        lastTaskId: input.lastTaskId,
        model: input.model,
        provider: input.provider,
        sessionDir: input.sessionDir ?? undefined,
        sessionPath: input.sessionPath ?? undefined,
        slotKey: input.slotKey,
        taskType: input.taskType,
        teamId: input.teamId,
        ttlSec: input.ttlSec,
        workspaceId: input.workspaceId ?? undefined,
        workspaceKind: input.workspaceKind,
        worktreeBranch: input.worktreeBranch ?? undefined,
        worktreePath: input.worktreePath ?? undefined,
      });
    },

    async finishSlot(
      teamId: string,
      taskId: string,
      attemptN: number,
      identity: DaemonSlotIdentity,
      slotKey: string,
      ttlSec: number,
      sessionPath: string | null,
    ) {
      await agent.daemonRuntimeSlots.finish({
        agentName: identity.agentName,
        attemptN,
        daemonId,
        model: identity.model,
        provider: identity.provider,
        sessionPath: sessionPath ?? undefined,
        slotKey,
        taskId,
        teamId,
        ttlSec,
      });
    },

    async findLatestProducerSlotByTaskAttempt(teamId, taskId, attemptN) {
      const resolved = await agent.daemonRuntimeSlots.findProducer({
        attemptN,
        taskId,
        teamId,
      });
      if (!resolved) return null;
      return {
        session: resolved.session,
        slot: { expiresAtMs: resolved.slot.expiresAtMs },
        workspace: resolved.workspace
          ? {
              kind: resolved.workspace.kind,
              workspaceId: resolved.workspace.workspaceId,
              worktreeBranch: resolved.workspace.worktreeBranch,
              worktreePath: resolved.workspace.worktreePath,
            }
          : null,
      } satisfies ResolvedDaemonRuntimeSlotContext;
    },

    async close() {
      // HTTP client lifetime is owned by the SDK Agent.
    },
  };
}
