import { and, desc, eq, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type RuntimeSlot,
  runtimeSlots,
  type RuntimeSlotSession,
  runtimeSlotSessions,
  type RuntimeWorkspace,
  runtimeWorkspaces,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export type RuntimeWorkspaceKind = 'origin' | 'fork' | 'scratch';

export interface BeginRuntimeSlotInput {
  teamId: string;
  daemonId: string;
  agentName: string;
  daemonProfileId?: string | null;
  provider: string;
  model: string;
  slotKey: string;
  taskType: string;
  sessionDir?: string | null;
  sessionPath?: string | null;
  workspaceId?: string | null;
  worktreePath?: string | null;
  worktreeBranch?: string | null;
  workspaceKind?: RuntimeWorkspaceKind;
  lastTaskId: string;
  lastAttemptN: number;
  ttlSec: number;
}

export interface FinishRuntimeSlotInput {
  teamId: string;
  daemonId: string;
  agentName: string;
  provider: string;
  model: string;
  slotKey: string;
  taskId: string;
  attemptN: number;
  ttlSec: number;
  sessionPath?: string | null;
}

export interface ResolvedRuntimeSlot {
  slot: RuntimeSlot;
  session: RuntimeSlotSession | null;
  workspace: RuntimeWorkspace | null;
}

export function createRuntimeSlotRepository(db: Database) {
  return {
    async begin(input: BeginRuntimeSlotInput): Promise<RuntimeSlot> {
      const now = Date.now();
      const workspaceRowId = await upsertWorkspace(input, now);
      const [slot] = await getExecutor(db)
        .insert(runtimeSlots)
        .values({
          agentName: input.agentName,
          createdAtMs: now,
          daemonId: input.daemonId,
          daemonProfileId: input.daemonProfileId ?? null,
          expiresAtMs: now + input.ttlSec * 1000,
          lastAttemptN: input.lastAttemptN,
          lastTaskId: input.lastTaskId,
          lastUsedAtMs: now,
          model: input.model,
          provider: input.provider,
          slotKey: input.slotKey,
          state: 'active',
          taskType: input.taskType,
          teamId: input.teamId,
          workspaceRowId,
        })
        .onConflictDoUpdate({
          set: {
            daemonProfileId: sql`excluded.daemon_profile_id`,
            expiresAtMs: sql`excluded.expires_at_ms`,
            lastAttemptN: sql`excluded.last_attempt_n`,
            lastTaskId: sql`excluded.last_task_id`,
            lastUsedAtMs: sql`excluded.last_used_at_ms`,
            state: 'active',
            taskType: sql`excluded.task_type`,
            updatedAt: sql`now()`,
            workspaceRowId: sql`excluded.workspace_row_id`,
          },
          target: [
            runtimeSlots.teamId,
            runtimeSlots.daemonId,
            runtimeSlots.agentName,
            runtimeSlots.provider,
            runtimeSlots.model,
            runtimeSlots.slotKey,
          ],
        })
        .returning();

      if (!slot) {
        throw new Error('failed to upsert runtime slot');
      }

      if (input.sessionDir) {
        await getExecutor(db)
          .insert(runtimeSlotSessions)
          .values({
            sessionDir: input.sessionDir,
            sessionPath: input.sessionPath ?? null,
            slotId: slot.id,
          })
          .onConflictDoUpdate({
            set: {
              sessionDir: sql`excluded.session_dir`,
              sessionPath: sql`excluded.session_path`,
              updatedAt: sql`now()`,
            },
            target: [runtimeSlotSessions.slotId],
          });
      }

      return slot;
    },

    async finish(input: FinishRuntimeSlotInput): Promise<RuntimeSlot | null> {
      const now = Date.now();
      const [slot] = await getExecutor(db)
        .update(runtimeSlots)
        .set({
          expiresAtMs: now + input.ttlSec * 1000,
          lastUsedAtMs: now,
          state: 'idle',
          updatedAt: sql`now()`,
        })
        .where(
          and(
            slotIdentityWhere(input),
            eq(runtimeSlots.lastTaskId, input.taskId),
            eq(runtimeSlots.lastAttemptN, input.attemptN),
          ),
        )
        .returning();

      if (!slot) return null;

      if (input.sessionPath !== undefined) {
        await getExecutor(db)
          .update(runtimeSlotSessions)
          .set({
            sessionPath: input.sessionPath,
            updatedAt: sql`now()`,
          })
          .where(eq(runtimeSlotSessions.slotId, slot.id));
      }

      return slot;
    },

    async findLatestProducerByTaskAttempt(
      teamId: string,
      taskId: string,
      attemptN: number,
    ): Promise<ResolvedRuntimeSlot | null> {
      const [slot] = await getExecutor(db)
        .select()
        .from(runtimeSlots)
        .where(
          and(
            eq(runtimeSlots.teamId, teamId),
            eq(runtimeSlots.lastTaskId, taskId),
            eq(runtimeSlots.lastAttemptN, attemptN),
          ),
        )
        .orderBy(desc(runtimeSlots.lastUsedAtMs))
        .limit(1);
      if (!slot) return null;
      return resolveSlot(slot);
    },
  };

  async function upsertWorkspace(
    input: BeginRuntimeSlotInput,
    now: number,
  ): Promise<string | null> {
    if (!input.workspaceId || !input.worktreePath) return null;
    const [workspace] = await getExecutor(db)
      .insert(runtimeWorkspaces)
      .values({
        createdAtMs: now,
        kind: input.workspaceKind ?? 'origin',
        lastUsedAtMs: now,
        teamId: input.teamId,
        workspaceId: input.workspaceId,
        worktreeBranch: input.worktreeBranch ?? null,
        worktreePath: input.worktreePath,
      })
      .onConflictDoUpdate({
        set: {
          lastUsedAtMs: sql`excluded.last_used_at_ms`,
          updatedAt: sql`now()`,
          worktreeBranch: sql`excluded.worktree_branch`,
          worktreePath: sql`excluded.worktree_path`,
        },
        target: [runtimeWorkspaces.teamId, runtimeWorkspaces.workspaceId],
      })
      .returning();
    return workspace?.id ?? null;
  }

  async function resolveSlot(slot: RuntimeSlot): Promise<ResolvedRuntimeSlot> {
    const [session = null] = await getExecutor(db)
      .select()
      .from(runtimeSlotSessions)
      .where(eq(runtimeSlotSessions.slotId, slot.id))
      .limit(1);
    const [workspace = null] = slot.workspaceRowId
      ? await getExecutor(db)
          .select()
          .from(runtimeWorkspaces)
          .where(eq(runtimeWorkspaces.id, slot.workspaceRowId))
          .limit(1)
      : [];
    return { session, slot, workspace };
  }
}

function slotIdentityWhere(input: {
  teamId: string;
  daemonId: string;
  agentName: string;
  provider: string;
  model: string;
  slotKey: string;
}) {
  return and(
    eq(runtimeSlots.teamId, input.teamId),
    eq(runtimeSlots.daemonId, input.daemonId),
    eq(runtimeSlots.agentName, input.agentName),
    eq(runtimeSlots.provider, input.provider),
    eq(runtimeSlots.model, input.model),
    eq(runtimeSlots.slotKey, input.slotKey),
  );
}

export type RuntimeSlotRepository = ReturnType<
  typeof createRuntimeSlotRepository
>;
