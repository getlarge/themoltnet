import type { Agent } from '@themoltnet/sdk';

import type { DaemonSlotIdentity } from './daemon-slot-identity.js';
import type {
  ResolvedRuntimeSlotContext,
  RuntimeSlotStore,
} from './execution-plan-cache.js';

export function createApiRuntimeSlotStore(args: {
  agent: Agent;
  daemonProfileId?: string | null;
}): RuntimeSlotStore {
  const { agent, daemonProfileId } = args;

  return {
    async beginSlot(input) {
      await agent.runtimeSlots.begin(
        {
          agentName: input.agentName,
          daemonProfileId: daemonProfileId ?? undefined,
          lastAttemptN: input.lastAttemptN,
          lastTaskId: input.lastTaskId,
          model: input.model,
          provider: input.provider,
          sessionDir: input.sessionDir ?? undefined,
          sessionPath: input.sessionPath ?? undefined,
          slotKey: input.slotKey,
          taskType: input.taskType,
          workspaceId: input.workspaceId ?? undefined,
          workspaceKind: input.workspaceKind,
          worktreeBranch: input.worktreeBranch ?? undefined,
          worktreePath: input.worktreePath ?? undefined,
        },
        {
          teamId: input.teamId,
        },
      );
    },

    async finishSlot(
      teamId: string,
      taskId: string,
      attemptN: number,
      identity: DaemonSlotIdentity,
      slotKey: string,
      sessionPath: string | null,
    ) {
      await agent.runtimeSlots.finish(
        {
          agentName: identity.agentName,
          attemptN,
          model: identity.model,
          provider: identity.provider,
          sessionPath: sessionPath ?? undefined,
          slotKey,
          taskId,
        },
        {
          teamId,
        },
      );
    },

    async findLatestSlotByTaskAttempt(teamId, taskId, attemptN) {
      const resolved = await agent.runtimeSlots.findLatestForAttempt(
        {
          attemptN,
          taskId,
        },
        {
          teamId,
        },
      );
      if (!resolved) return null;
      return {
        slot: { expiresAtMs: resolved.slot.expiresAtMs },
        session: resolved.slot.sessionDir
          ? {
              sessionDir: resolved.slot.sessionDir,
              sessionPath: resolved.slot.sessionPath,
            }
          : null,
        workspace: resolved.workspace
          ? {
              kind: resolved.workspace.kind,
              workspaceId: resolved.workspace.workspaceId,
              worktreeBranch: resolved.workspace.worktreeBranch,
              worktreePath: resolved.workspace.worktreePath,
            }
          : null,
      } satisfies ResolvedRuntimeSlotContext;
    },

    async close() {
      // HTTP client lifetime is owned by the SDK Agent.
    },
  };
}
