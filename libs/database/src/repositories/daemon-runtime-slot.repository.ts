import { and, desc, eq, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type DaemonRuntimeSlot,
  daemonRuntimeSlots,
  type DaemonRuntimeSlotSession,
  daemonRuntimeSlotSessions,
  type DaemonRuntimeWorkspace,
  daemonRuntimeWorkspaces,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export type DaemonRuntimeWorkspaceKind = 'origin' | 'fork' | 'scratch';

export interface BeginDaemonRuntimeSlotInput {
  teamId: string;
  daemonId: string;
  agentName: string;
  agentIdentityId: string;
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
  workspaceKind?: DaemonRuntimeWorkspaceKind;
  lastTaskId: string;
  lastAttemptN: number;
  ttlSec: number;
}

export interface FinishDaemonRuntimeSlotInput {
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

export interface ResolvedDaemonRuntimeSlot {
  slot: DaemonRuntimeSlot;
  session: DaemonRuntimeSlotSession | null;
  workspace: DaemonRuntimeWorkspace | null;
}

export function createDaemonRuntimeSlotRepository(db: Database) {
  return {
    async begin(
      input: BeginDaemonRuntimeSlotInput,
    ): Promise<DaemonRuntimeSlot> {
      const now = Date.now();
      const workspaceRowId = await upsertWorkspace(input, now);
      const [slot] = await getExecutor(db)
        .insert(daemonRuntimeSlots)
        .values({
          agentIdentityId: input.agentIdentityId,
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
            agentIdentityId: sql`excluded.agent_identity_id`,
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
            daemonRuntimeSlots.teamId,
            daemonRuntimeSlots.daemonId,
            daemonRuntimeSlots.agentName,
            daemonRuntimeSlots.provider,
            daemonRuntimeSlots.model,
            daemonRuntimeSlots.slotKey,
          ],
        })
        .returning();

      if (!slot) {
        throw new Error('failed to upsert daemon runtime slot');
      }

      if (input.sessionDir) {
        await getExecutor(db)
          .insert(daemonRuntimeSlotSessions)
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
            target: [daemonRuntimeSlotSessions.slotId],
          });
      }

      return slot;
    },

    async finish(
      input: FinishDaemonRuntimeSlotInput,
    ): Promise<DaemonRuntimeSlot | null> {
      const now = Date.now();
      const [slot] = await getExecutor(db)
        .update(daemonRuntimeSlots)
        .set({
          expiresAtMs: now + input.ttlSec * 1000,
          lastUsedAtMs: now,
          state: 'idle',
          updatedAt: sql`now()`,
        })
        .where(
          and(
            slotIdentityWhere(input),
            eq(daemonRuntimeSlots.lastTaskId, input.taskId),
            eq(daemonRuntimeSlots.lastAttemptN, input.attemptN),
          ),
        )
        .returning();

      if (!slot) return null;

      if (input.sessionPath !== undefined) {
        await getExecutor(db)
          .update(daemonRuntimeSlotSessions)
          .set({
            sessionPath: input.sessionPath,
            updatedAt: sql`now()`,
          })
          .where(eq(daemonRuntimeSlotSessions.slotId, slot.id));
      }

      return slot;
    },

    async findLatestProducerByTaskAttempt(
      teamId: string,
      taskId: string,
      attemptN: number,
    ): Promise<ResolvedDaemonRuntimeSlot | null> {
      const [slot] = await getExecutor(db)
        .select()
        .from(daemonRuntimeSlots)
        .where(
          and(
            eq(daemonRuntimeSlots.teamId, teamId),
            eq(daemonRuntimeSlots.lastTaskId, taskId),
            eq(daemonRuntimeSlots.lastAttemptN, attemptN),
          ),
        )
        .orderBy(desc(daemonRuntimeSlots.lastUsedAtMs))
        .limit(1);
      if (!slot) return null;
      return resolveSlot(slot);
    },
  };

  async function upsertWorkspace(
    input: BeginDaemonRuntimeSlotInput,
    now: number,
  ): Promise<string | null> {
    if (!input.workspaceId || !input.worktreePath) return null;
    const [workspace] = await getExecutor(db)
      .insert(daemonRuntimeWorkspaces)
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
        target: [
          daemonRuntimeWorkspaces.teamId,
          daemonRuntimeWorkspaces.workspaceId,
        ],
      })
      .returning();
    return workspace?.id ?? null;
  }

  async function resolveSlot(
    slot: DaemonRuntimeSlot,
  ): Promise<ResolvedDaemonRuntimeSlot> {
    const [session = null] = await getExecutor(db)
      .select()
      .from(daemonRuntimeSlotSessions)
      .where(eq(daemonRuntimeSlotSessions.slotId, slot.id))
      .limit(1);
    const [workspace = null] = slot.workspaceRowId
      ? await getExecutor(db)
          .select()
          .from(daemonRuntimeWorkspaces)
          .where(eq(daemonRuntimeWorkspaces.id, slot.workspaceRowId))
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
    eq(daemonRuntimeSlots.teamId, input.teamId),
    eq(daemonRuntimeSlots.daemonId, input.daemonId),
    eq(daemonRuntimeSlots.agentName, input.agentName),
    eq(daemonRuntimeSlots.provider, input.provider),
    eq(daemonRuntimeSlots.model, input.model),
    eq(daemonRuntimeSlots.slotKey, input.slotKey),
  );
}

export type DaemonRuntimeSlotRepository = ReturnType<
  typeof createDaemonRuntimeSlotRepository
>;
