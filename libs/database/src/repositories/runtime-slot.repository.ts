import { and, desc, eq, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  daemonProfiles,
  type RuntimeSlot,
  runtimeSlots,
  type RuntimeWorkspace,
  runtimeWorkspaces,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

const DEFAULT_RUNTIME_SLOT_TTL_SEC = 1800;

export type RuntimeWorkspaceKind = 'origin' | 'fork' | 'scratch';

export interface BeginRuntimeSlotInput {
  teamId: string;
  agentName: string;
  daemonProfileId: string;
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
}

export interface FinishRuntimeSlotInput {
  teamId: string;
  agentName: string;
  daemonProfileId: string;
  provider: string;
  model: string;
  slotKey: string;
  taskId: string;
  attemptN: number;
  sessionPath?: string | null;
}

export interface ResolvedRuntimeSlot {
  slot: RuntimeSlot;
  workspace: RuntimeWorkspace | null;
}

export function createRuntimeSlotRepository(db: Database) {
  return {
    async begin(input: BeginRuntimeSlotInput): Promise<RuntimeSlot> {
      const now = Date.now();
      const slotLifetimeSec = await resolveSlotLifetimeSec(
        input.daemonProfileId,
      );
      const workspaceRowId = await upsertWorkspace(input, now);
      const [slot] = await getExecutor(db)
        .insert(runtimeSlots)
        .values({
          agentName: input.agentName,
          createdAtMs: now,
          daemonProfileId: input.daemonProfileId,
          expiresAtMs: now + slotLifetimeSec * 1000,
          lastAttemptN: input.lastAttemptN,
          lastTaskId: input.lastTaskId,
          lastUsedAtMs: now,
          model: input.model,
          provider: input.provider,
          sessionDir: input.sessionDir ?? null,
          sessionPath: input.sessionPath ?? null,
          slotKey: input.slotKey,
          state: 'active',
          taskType: input.taskType,
          teamId: input.teamId,
          workspaceRowId,
        })
        .onConflictDoUpdate({
          set: runtimeSlotUpsertSet(),
          target: [
            runtimeSlots.teamId,
            runtimeSlots.agentName,
            runtimeSlots.daemonProfileId,
            runtimeSlots.slotKey,
          ],
        })
        .returning();

      if (!slot) {
        throw new Error('failed to upsert runtime slot');
      }

      return slot;
    },

    async finish(input: FinishRuntimeSlotInput): Promise<RuntimeSlot | null> {
      const now = Date.now();
      const slotLifetimeSec = await resolveSlotLifetimeSecForIdentity(input);
      const set = {
        expiresAtMs: now + slotLifetimeSec * 1000,
        lastUsedAtMs: now,
        state: 'idle' as const,
        updatedAt: sql`now()`,
        ...(input.sessionPath !== undefined
          ? { sessionPath: input.sessionPath }
          : {}),
      };
      const [slot] = await getExecutor(db)
        .update(runtimeSlots)
        .set(set)
        .where(
          and(
            slotIdentityWhere(input),
            eq(runtimeSlots.lastTaskId, input.taskId),
            eq(runtimeSlots.lastAttemptN, input.attemptN),
          ),
        )
        .returning();

      if (!slot) return null;

      return slot;
    },

    async findLatestByTaskAttempt(
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

  async function resolveSlotLifetimeSec(
    daemonProfileId: string,
  ): Promise<number> {
    const [profile] = await getExecutor(db)
      .select({ sessionTtlSec: daemonProfiles.sessionTtlSec })
      .from(daemonProfiles)
      .where(eq(daemonProfiles.id, daemonProfileId))
      .limit(1);
    return profile?.sessionTtlSec ?? DEFAULT_RUNTIME_SLOT_TTL_SEC;
  }

  async function resolveSlotLifetimeSecForIdentity(
    input: FinishRuntimeSlotInput,
  ): Promise<number> {
    const [slot] = await getExecutor(db)
      .select({ daemonProfileId: runtimeSlots.daemonProfileId })
      .from(runtimeSlots)
      .where(
        and(
          slotIdentityWhere(input),
          eq(runtimeSlots.lastTaskId, input.taskId),
          eq(runtimeSlots.lastAttemptN, input.attemptN),
        ),
      )
      .limit(1);
    return slot?.daemonProfileId
      ? resolveSlotLifetimeSec(slot.daemonProfileId)
      : DEFAULT_RUNTIME_SLOT_TTL_SEC;
  }

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
    const [workspace = null] = slot.workspaceRowId
      ? await getExecutor(db)
          .select()
          .from(runtimeWorkspaces)
          .where(eq(runtimeWorkspaces.id, slot.workspaceRowId))
          .limit(1)
      : [];
    return { slot, workspace };
  }
}

function slotIdentityWhere(input: {
  teamId: string;
  agentName: string;
  daemonProfileId: string;
  provider: string;
  model: string;
  slotKey: string;
}) {
  return and(
    eq(runtimeSlots.teamId, input.teamId),
    eq(runtimeSlots.agentName, input.agentName),
    eq(runtimeSlots.daemonProfileId, input.daemonProfileId),
    eq(runtimeSlots.slotKey, input.slotKey),
  );
}

function runtimeSlotUpsertSet() {
  return {
    daemonProfileId: sql`excluded.daemon_profile_id`,
    expiresAtMs: sql`excluded.expires_at_ms`,
    lastAttemptN: sql`excluded.last_attempt_n`,
    lastTaskId: sql`excluded.last_task_id`,
    lastUsedAtMs: sql`excluded.last_used_at_ms`,
    model: sql`excluded.model`,
    provider: sql`excluded.provider`,
    sessionDir: sql`excluded.session_dir`,
    sessionPath: sql`excluded.session_path`,
    state: 'active' as const,
    taskType: sql`excluded.task_type`,
    updatedAt: sql`now()`,
    workspaceRowId: sql`excluded.workspace_row_id`,
  };
}

export type RuntimeSlotRepository = ReturnType<
  typeof createRuntimeSlotRepository
>;
