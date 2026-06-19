import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { and, desc, eq, lte, sql } from 'drizzle-orm';
import {
  drizzle as drizzlePg,
  type NodePgDatabase,
} from 'drizzle-orm/node-postgres';
import {
  drizzle as drizzleSqlite,
  type SqliteRemoteDatabase,
} from 'drizzle-orm/sqlite-proxy';
import { Pool } from 'pg';

import { applySqliteMigrations, runPgMigrations } from './migrate.js';
import {
  pgAgentDaemonStateSchema,
  pgDaemonSlots,
  pgDaemonSlotSessions,
  pgDaemonWorkspaces,
} from './pg-schema.js';
import {
  agentDaemonStateSchema,
  daemonSlots,
  daemonSlotSessions,
  daemonWorkspaces,
} from './schema.js';

export class DaemonSlotRegistryError extends Error {
  constructor(
    public readonly operation: string,
    cause: unknown,
  ) {
    super(`Daemon slot registry failed during ${operation}`, { cause });
    this.name = 'DaemonSlotRegistryError';
  }
}

export interface DaemonSlotIdentity {
  agentName: string;
  provider: string;
  model: string;
}

export interface DaemonSlotRecord extends DaemonSlotIdentity {
  slotKey: string;
  taskType: string;
  state: 'active' | 'idle';
  lastTaskId: string;
  lastAttemptN: number;
  workspaceId: string | null;
  createdAtMs: number;
  lastUsedAtMs: number;
  expiresAtMs: number;
}

export interface DaemonSlotSessionRecord extends DaemonSlotIdentity {
  slotKey: string;
  sessionDir: string;
  sessionPath: string | null;
}

export type DaemonWorkspaceKind = 'origin' | 'fork' | 'scratch';

/**
 * A refcounted workspace, shared by N slots that resume the same task chain.
 * No longer carries slot identity — it is an independent entity resolved via
 * `daemon_slots.workspace_id`.
 */
export interface DaemonSlotWorkspaceRecord {
  workspaceId: string;
  worktreePath: string;
  worktreeBranch: string | null;
  kind: DaemonWorkspaceKind;
  refcount: number;
}

export interface ReapedDaemonSlot {
  slot: DaemonSlotRecord;
  session: DaemonSlotSessionRecord | null;
  workspace: DaemonSlotWorkspaceRecord | null;
}

export interface ResolvedProducerDaemonSlot {
  slot: DaemonSlotRecord;
  session: DaemonSlotSessionRecord | null;
  workspace: DaemonSlotWorkspaceRecord | null;
}

export interface DaemonSlotStartInput extends DaemonSlotIdentity {
  slotKey: string;
  taskType: string;
  sessionDir: string | null;
  sessionPath: string | null;
  workspaceId: string | null;
  worktreePath: string | null;
  worktreeBranch: string | null;
  /** Workspace lifecycle kind; defaults to 'origin'. */
  workspaceKind?: DaemonWorkspaceKind;
  lastTaskId: string;
  lastAttemptN: number;
  ttlSec: number;
}

export type DaemonStateStorageConfig =
  | { kind: 'sqlite'; path: string }
  | { kind: 'postgres'; connectionString: string };

interface DaemonSlotStore {
  close(): Promise<void>;
  beginSlot(input: DaemonSlotStartInput): Promise<void>;
  finishSlot(
    identity: DaemonSlotIdentity,
    slotKey: string,
    ttlSec: number,
    sessionPath: string | null,
  ): Promise<void>;
  findLatestProducerSlotByTaskAttempt(
    taskId: string,
    attemptN: number,
  ): Promise<ResolvedProducerDaemonSlot | null>;
  reapExpiredSlots(now: number): Promise<ReapedDaemonSlot[]>;
}

export class DaemonSlotRegistry {
  private readonly store: DaemonSlotStore;

  constructor(config: string | DaemonStateStorageConfig) {
    this.store =
      typeof config === 'string'
        ? new SqliteDaemonSlotStore(config)
        : config.kind === 'sqlite'
          ? new SqliteDaemonSlotStore(config.path)
          : new PgDaemonSlotStore(config.connectionString);
  }

  close(): Promise<void> {
    return this.store.close();
  }

  beginSlot(input: DaemonSlotStartInput): Promise<void> {
    return this.store.beginSlot(input);
  }

  finishSlot(
    identity: DaemonSlotIdentity,
    slotKey: string,
    ttlSec: number,
    sessionPath: string | null,
  ): Promise<void> {
    return this.store.finishSlot(identity, slotKey, ttlSec, sessionPath);
  }

  findLatestProducerSlotByTaskAttempt(
    taskId: string,
    attemptN: number,
  ): Promise<ResolvedProducerDaemonSlot | null> {
    return this.store.findLatestProducerSlotByTaskAttempt(taskId, attemptN);
  }

  reapExpiredSlots(now = Date.now()): Promise<ReapedDaemonSlot[]> {
    return this.store.reapExpiredSlots(now);
  }
}

type SqliteDb = SqliteRemoteDatabase<typeof agentDaemonStateSchema>;

class SqliteDaemonSlotStore implements DaemonSlotStore {
  private readonly client: DatabaseSync;
  private readonly db: SqliteDb;

  constructor(dbPath: string) {
    try {
      this.client = new DatabaseSync(dbPath);
      this.db = drizzleSqlite(
        (query, params, method) =>
          this.executeProxyQuery(query, params, method),
        { schema: agentDaemonStateSchema },
      );
      this.withSyncDb('initialize sqlite schema', () => {
        this.client.exec('PRAGMA journal_mode = WAL');
        this.client.exec('PRAGMA foreign_keys = ON');
        applySqliteMigrations(this.client);
      });
    } catch (error) {
      throw new DaemonSlotRegistryError('open sqlite database', error);
    }
  }

  close(): Promise<void> {
    return Promise.resolve(
      this.withSyncDb('close sqlite database', () => this.client.close()),
    );
  }

  async beginSlot(input: DaemonSlotStartInput): Promise<void> {
    const now = Date.now();
    const expiresAtMs = now + input.ttlSec * 1000;
    const workspaceId =
      input.workspaceId !== null && input.worktreePath !== null
        ? input.workspaceId
        : null;

    // Slot + workspace refcount in one synchronous transaction. The slot ->
    // workspace direction means a slot's workspace_id reference is what the
    // refcount counts; we read the prior reference before upserting the slot
    // so re-warming the same pairing is idempotent (no double count) and
    // switching workspaces moves the count.
    this.withSyncDb('upsert sqlite slot + workspace', () => {
      this.client.exec('BEGIN IMMEDIATE');
      try {
        const priorWorkspaceId = this.priorSlotWorkspaceId(input);

        if (workspaceId !== null) {
          // Insert the workspace at refcount 0 if new; existing rows just
          // refresh their mutable fields. The refcount delta is applied below.
          // `kind` and `created_at_ms` are intentionally NOT refreshed: a
          // workspace's lifecycle kind is immutable per id (origin/fork ids are
          // unique, scratch ids are per-slot), so a conflicting upsert is always
          // the same kind.
          this.client
            .prepare(
              `INSERT INTO daemon_workspaces
                 (workspace_id, worktree_path, worktree_branch, kind,
                  refcount, created_at_ms, last_used_at_ms)
               VALUES (?, ?, ?, ?, 0, ?, ?)
               ON CONFLICT(workspace_id) DO UPDATE SET
                 worktree_path = excluded.worktree_path,
                 worktree_branch = excluded.worktree_branch,
                 last_used_at_ms = excluded.last_used_at_ms`,
            )
            .run(
              workspaceId,
              input.worktreePath as string,
              input.worktreeBranch,
              input.workspaceKind ?? 'origin',
              now,
              now,
            );
        }

        this.client
          .prepare(
            `INSERT INTO daemon_slots
               (agent_name, provider, model, slot_key, task_type, state,
                last_task_id, last_attempt_n, workspace_id, created_at_ms,
                last_used_at_ms, expires_at_ms)
             VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
             ON CONFLICT(agent_name, provider, model, slot_key) DO UPDATE SET
               task_type = excluded.task_type,
               state = 'active',
               last_task_id = excluded.last_task_id,
               last_attempt_n = excluded.last_attempt_n,
               workspace_id = excluded.workspace_id,
               last_used_at_ms = excluded.last_used_at_ms,
               expires_at_ms = excluded.expires_at_ms`,
          )
          .run(
            input.agentName,
            input.provider,
            input.model,
            input.slotKey,
            input.taskType,
            input.lastTaskId,
            input.lastAttemptN,
            workspaceId,
            now,
            now,
            expiresAtMs,
          );

        // Apply the refcount delta only when the slot's workspace reference
        // actually changed.
        if (priorWorkspaceId !== workspaceId) {
          if (priorWorkspaceId !== null) {
            this.decrementWorkspaceRefcount(priorWorkspaceId);
          }
          if (workspaceId !== null) {
            this.client
              .prepare(
                `UPDATE daemon_workspaces SET refcount = refcount + 1
                   WHERE workspace_id = ?`,
              )
              .run(workspaceId);
          }
        }

        this.client.exec('COMMIT');
      } catch (error) {
        try {
          this.client.exec('ROLLBACK');
        } catch {
          // surface the original error
        }
        throw error;
      }
    });

    const sessionDir = input.sessionDir;
    if (sessionDir !== null) {
      await this.withDb('upsert sqlite slot session', () =>
        this.db
          .insert(daemonSlotSessions)
          .values({
            agentName: input.agentName,
            model: input.model,
            provider: input.provider,
            sessionDir,
            sessionPath: input.sessionPath,
            slotKey: input.slotKey,
          })
          .onConflictDoUpdate({
            set: {
              sessionDir: sql`excluded.session_dir`,
              sessionPath: sql`excluded.session_path`,
            },
            target: [
              daemonSlotSessions.agentName,
              daemonSlotSessions.provider,
              daemonSlotSessions.model,
              daemonSlotSessions.slotKey,
            ],
          })
          .run(),
      );
    }
  }

  /** The workspace_id the slot referenced before this begin, or null. */
  private priorSlotWorkspaceId(slot: DaemonSlotIdentity & { slotKey: string }) {
    const row = this.client
      .prepare(
        `SELECT workspace_id AS workspaceId FROM daemon_slots
           WHERE agent_name = ? AND provider = ? AND model = ? AND slot_key = ?`,
      )
      .get(slot.agentName, slot.provider, slot.model, slot.slotKey) as
      | { workspaceId: string | null }
      | undefined;
    return row?.workspaceId ?? null;
  }

  /** Decrement a workspace refcount; delete the row when it reaches 0. */
  private decrementWorkspaceRefcount(workspaceId: string): void {
    this.client
      .prepare(
        `UPDATE daemon_workspaces SET refcount = refcount - 1
           WHERE workspace_id = ?`,
      )
      .run(workspaceId);
    this.client
      .prepare(
        `DELETE FROM daemon_workspaces WHERE workspace_id = ? AND refcount <= 0`,
      )
      .run(workspaceId);
  }

  async finishSlot(
    identity: DaemonSlotIdentity,
    slotKey: string,
    ttlSec: number,
    sessionPath: string | null,
  ): Promise<void> {
    const now = Date.now();
    await this.withDb('finish sqlite slot', () =>
      this.db
        .update(daemonSlots)
        .set({
          expiresAtMs: now + ttlSec * 1000,
          lastUsedAtMs: now,
          state: 'idle',
        })
        .where(sqliteSlotIdentityWhere(identity, slotKey))
        .run(),
    );

    if (sessionPath !== null) {
      await this.withDb('update sqlite slot session path', () =>
        this.db
          .update(daemonSlotSessions)
          .set({ sessionPath })
          .where(sqliteSlotSessionIdentityWhere(identity, slotKey))
          .run(),
      );
    }
  }

  async findLatestProducerSlotByTaskAttempt(
    taskId: string,
    attemptN: number,
  ): Promise<ResolvedProducerDaemonSlot | null> {
    const slot = await this.withDb(
      'find sqlite producer slot by task attempt',
      async () =>
        (await this.db
          .select()
          .from(daemonSlots)
          .where(
            and(
              eq(daemonSlots.lastTaskId, taskId),
              eq(daemonSlots.lastAttemptN, attemptN),
            ),
          )
          .orderBy(desc(daemonSlots.lastUsedAtMs))
          .limit(1)
          .get()) ?? null,
    );

    if (!slot) return null;

    return {
      session: await this.lookupSession(slot),
      slot,
      workspace: await this.lookupWorkspace(slot),
    };
  }

  async reapExpiredSlots(now = Date.now()): Promise<ReapedDaemonSlot[]> {
    try {
      const slots = await this.withDb('select expired sqlite slots', () =>
        this.db
          .select()
          .from(daemonSlots)
          .where(lte(daemonSlots.expiresAtMs, now))
          .all(),
      );

      const out: ReapedDaemonSlot[] = [];
      for (const slot of slots) {
        out.push({
          session: await this.lookupSession(slot),
          slot,
          workspace: await this.lookupWorkspace(slot),
        });
      }

      // Delete slots, decrement each referenced workspace's refcount, and
      // collect the workspaces that reached 0 (their disk artifacts are then
      // removed below). A workspace still referenced by a live slot survives.
      const releasable = this.withSyncDb<DaemonSlotWorkspaceRecord[]>(
        'delete expired sqlite slots',
        () => {
          this.client.exec('BEGIN IMMEDIATE');
          try {
            const orphaned: DaemonSlotWorkspaceRecord[] = [];
            for (const reaped of out) {
              this.client
                .prepare(
                  `DELETE FROM daemon_slots
                   WHERE agent_name = ? AND provider = ? AND model = ?
                     AND slot_key = ?`,
                )
                .run(
                  reaped.slot.agentName,
                  reaped.slot.provider,
                  reaped.slot.model,
                  reaped.slot.slotKey,
                );
              const ws = reaped.workspace;
              if (ws) {
                this.client
                  .prepare(
                    `UPDATE daemon_workspaces SET refcount = refcount - 1
                       WHERE workspace_id = ?`,
                  )
                  .run(ws.workspaceId);
                const row = this.client
                  .prepare(
                    `SELECT refcount FROM daemon_workspaces WHERE workspace_id = ?`,
                  )
                  .get(ws.workspaceId) as { refcount: number } | undefined;
                if (!row || row.refcount <= 0) {
                  this.client
                    .prepare(
                      `DELETE FROM daemon_workspaces WHERE workspace_id = ?`,
                    )
                    .run(ws.workspaceId);
                  orphaned.push(ws);
                }
              }
            }
            this.client.exec('COMMIT');
            return orphaned;
          } catch (error) {
            try {
              this.client.exec('ROLLBACK');
            } catch {
              // Ignore rollback failures and surface the original error.
            }
            throw error;
          }
        },
      );

      cleanupReapedSessions(out);
      cleanupReleasableWorkspaces(releasable);
      return out;
    } catch (error) {
      throw error instanceof DaemonSlotRegistryError
        ? error
        : new DaemonSlotRegistryError('reap expired sqlite slots', error);
    }
  }

  private async lookupSession(
    slot: Pick<
      DaemonSlotRecord,
      'agentName' | 'provider' | 'model' | 'slotKey'
    >,
  ): Promise<DaemonSlotSessionRecord | null> {
    return this.withDb(
      'select sqlite slot session',
      async () =>
        (await this.db
          .select()
          .from(daemonSlotSessions)
          .where(sqliteSlotSessionIdentityWhere(slot, slot.slotKey))
          .get()) ?? null,
    );
  }

  private async lookupWorkspace(
    slot: Pick<DaemonSlotRecord, 'workspaceId'>,
  ): Promise<DaemonSlotWorkspaceRecord | null> {
    if (!slot.workspaceId) return null;
    return this.withDb(
      'select sqlite workspace',
      async () =>
        (await this.db
          .select()
          .from(daemonWorkspaces)
          .where(eq(daemonWorkspaces.workspaceId, slot.workspaceId as string))
          .get()) ?? null,
    );
  }

  private executeProxyQuery(
    query: string,
    params: unknown[],
    method: 'run' | 'all' | 'values' | 'get',
  ): Promise<{ rows: unknown[] }> {
    return Promise.resolve(
      this.withSyncDb('execute sqlite proxy query', () => {
        const statement = this.client.prepare(query);
        const input = params as SQLInputValue[];
        if (method === 'run') {
          statement.run(...input);
          return { rows: [] };
        }

        statement.setReturnArrays(true);
        if (method === 'get') {
          return {
            rows: (statement.get(...input) ??
              undefined) as unknown as unknown[],
          };
        }
        return { rows: statement.all(...input) as unknown as unknown[] };
      }),
    );
  }

  private async withDb<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw new DaemonSlotRegistryError(operation, error);
    }
  }

  private withSyncDb<T>(operation: string, fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      throw new DaemonSlotRegistryError(operation, error);
    }
  }
}

type PgDb = NodePgDatabase<typeof pgAgentDaemonStateSchema>;

class PgDaemonSlotStore implements DaemonSlotStore {
  private readonly pool: Pool;
  private readonly db: PgDb;
  private readonly ready: Promise<void>;

  constructor(connectionString: string) {
    try {
      this.pool = new Pool({ connectionString });
      this.db = drizzlePg(this.pool, { schema: pgAgentDaemonStateSchema });
      this.ready = this.initialize();
    } catch (error) {
      throw new DaemonSlotRegistryError('open postgres database', error);
    }
  }

  async close(): Promise<void> {
    await this.withDb('close postgres database', () => this.pool.end());
  }

  async beginSlot(input: DaemonSlotStartInput): Promise<void> {
    await this.ready;
    const now = Date.now();
    const expiresAtMs = now + input.ttlSec * 1000;

    const beginWorkspaceId =
      input.workspaceId !== null && input.worktreePath !== null
        ? input.workspaceId
        : null;

    // Slot + workspace refcount in one transaction (see SQLite store for the
    // refcount rationale). Read the slot's prior workspace_id so re-warming the
    // same pairing is idempotent and switching workspaces moves the count.
    await this.withDb('upsert postgres slot + workspace', () =>
      this.db.transaction(async (tx) => {
        const [priorRow] = await tx
          .select({ workspaceId: pgDaemonSlots.workspaceId })
          .from(pgDaemonSlots)
          .where(pgSlotIdentityWhere(input, input.slotKey))
          .limit(1)
          .execute();
        const priorWorkspaceId = priorRow?.workspaceId ?? null;

        if (beginWorkspaceId !== null) {
          // `kind`/`createdAtMs` intentionally not refreshed on conflict — a
          // workspace's lifecycle kind is immutable per id (see SQLite store).
          await tx
            .insert(pgDaemonWorkspaces)
            .values({
              workspaceId: beginWorkspaceId,
              worktreePath: input.worktreePath as string,
              worktreeBranch: input.worktreeBranch,
              kind: input.workspaceKind ?? 'origin',
              refcount: 0,
              createdAtMs: now,
              lastUsedAtMs: now,
            })
            .onConflictDoUpdate({
              set: {
                worktreePath: sql`excluded.worktree_path`,
                worktreeBranch: sql`excluded.worktree_branch`,
                lastUsedAtMs: sql`excluded.last_used_at_ms`,
              },
              target: [pgDaemonWorkspaces.workspaceId],
            })
            .execute();
        }

        await tx
          .insert(pgDaemonSlots)
          .values({
            agentName: input.agentName,
            createdAtMs: now,
            expiresAtMs,
            lastAttemptN: input.lastAttemptN,
            lastTaskId: input.lastTaskId,
            lastUsedAtMs: now,
            model: input.model,
            provider: input.provider,
            slotKey: input.slotKey,
            state: 'active',
            taskType: input.taskType,
            workspaceId: beginWorkspaceId,
          })
          .onConflictDoUpdate({
            set: {
              expiresAtMs: sql`excluded.expires_at_ms`,
              lastAttemptN: sql`excluded.last_attempt_n`,
              lastTaskId: sql`excluded.last_task_id`,
              lastUsedAtMs: sql`excluded.last_used_at_ms`,
              state: 'active',
              taskType: sql`excluded.task_type`,
              workspaceId: sql`excluded.workspace_id`,
            },
            target: [
              pgDaemonSlots.agentName,
              pgDaemonSlots.provider,
              pgDaemonSlots.model,
              pgDaemonSlots.slotKey,
            ],
          })
          .execute();

        if (priorWorkspaceId !== beginWorkspaceId) {
          if (priorWorkspaceId !== null) {
            await tx
              .update(pgDaemonWorkspaces)
              .set({ refcount: sql`${pgDaemonWorkspaces.refcount} - 1` })
              .where(eq(pgDaemonWorkspaces.workspaceId, priorWorkspaceId))
              .execute();
            await tx
              .delete(pgDaemonWorkspaces)
              .where(
                and(
                  eq(pgDaemonWorkspaces.workspaceId, priorWorkspaceId),
                  lte(pgDaemonWorkspaces.refcount, 0),
                ),
              )
              .execute();
          }
          if (beginWorkspaceId !== null) {
            await tx
              .update(pgDaemonWorkspaces)
              .set({ refcount: sql`${pgDaemonWorkspaces.refcount} + 1` })
              .where(eq(pgDaemonWorkspaces.workspaceId, beginWorkspaceId))
              .execute();
          }
        }
      }),
    );

    const sessionDir = input.sessionDir;
    if (sessionDir !== null) {
      await this.withDb('upsert postgres slot session', () =>
        this.db
          .insert(pgDaemonSlotSessions)
          .values({
            agentName: input.agentName,
            model: input.model,
            provider: input.provider,
            sessionDir,
            sessionPath: input.sessionPath,
            slotKey: input.slotKey,
          })
          .onConflictDoUpdate({
            set: {
              sessionDir: sql`excluded.session_dir`,
              sessionPath: sql`excluded.session_path`,
            },
            target: [
              pgDaemonSlotSessions.agentName,
              pgDaemonSlotSessions.provider,
              pgDaemonSlotSessions.model,
              pgDaemonSlotSessions.slotKey,
            ],
          })
          .execute(),
      );
    }
  }

  async finishSlot(
    identity: DaemonSlotIdentity,
    slotKey: string,
    ttlSec: number,
    sessionPath: string | null,
  ): Promise<void> {
    await this.ready;
    const now = Date.now();
    await this.withDb('finish postgres slot', () =>
      this.db
        .update(pgDaemonSlots)
        .set({
          expiresAtMs: now + ttlSec * 1000,
          lastUsedAtMs: now,
          state: 'idle',
        })
        .where(pgSlotIdentityWhere(identity, slotKey))
        .execute(),
    );

    if (sessionPath !== null) {
      await this.withDb('update postgres slot session path', () =>
        this.db
          .update(pgDaemonSlotSessions)
          .set({ sessionPath })
          .where(pgSlotSessionIdentityWhere(identity, slotKey))
          .execute(),
      );
    }
  }

  async findLatestProducerSlotByTaskAttempt(
    taskId: string,
    attemptN: number,
  ): Promise<ResolvedProducerDaemonSlot | null> {
    await this.ready;
    const [slot] = await this.withDb(
      'find postgres producer slot by task attempt',
      () =>
        this.db
          .select()
          .from(pgDaemonSlots)
          .where(
            and(
              eq(pgDaemonSlots.lastTaskId, taskId),
              eq(pgDaemonSlots.lastAttemptN, attemptN),
            ),
          )
          .orderBy(desc(pgDaemonSlots.lastUsedAtMs))
          .limit(1)
          .execute(),
    );

    if (!slot) return null;

    return {
      session: await this.lookupSession(slot),
      slot,
      workspace: await this.lookupWorkspace(slot),
    };
  }

  async reapExpiredSlots(now = Date.now()): Promise<ReapedDaemonSlot[]> {
    await this.ready;
    try {
      const { out, releasable } = await this.db.transaction(async (tx) => {
        const slots = await tx
          .select()
          .from(pgDaemonSlots)
          .where(lte(pgDaemonSlots.expiresAtMs, now))
          .execute();
        const reaped: ReapedDaemonSlot[] = [];
        const orphaned: DaemonSlotWorkspaceRecord[] = [];
        for (const slot of slots) {
          const [session = null] = await tx
            .select()
            .from(pgDaemonSlotSessions)
            .where(pgSlotSessionIdentityWhere(slot, slot.slotKey))
            .limit(1)
            .execute();
          const workspace = slot.workspaceId
            ? ((
                await tx
                  .select()
                  .from(pgDaemonWorkspaces)
                  .where(eq(pgDaemonWorkspaces.workspaceId, slot.workspaceId))
                  .limit(1)
                  .execute()
              )[0] ?? null)
            : null;
          reaped.push({ session, slot, workspace });
          await tx
            .delete(pgDaemonSlots)
            .where(pgSlotIdentityWhere(slot, slot.slotKey))
            .execute();
          if (workspace) {
            await tx
              .update(pgDaemonWorkspaces)
              .set({ refcount: sql`${pgDaemonWorkspaces.refcount} - 1` })
              .where(eq(pgDaemonWorkspaces.workspaceId, workspace.workspaceId))
              .execute();
            const [after] = await tx
              .select({ refcount: pgDaemonWorkspaces.refcount })
              .from(pgDaemonWorkspaces)
              .where(eq(pgDaemonWorkspaces.workspaceId, workspace.workspaceId))
              .limit(1)
              .execute();
            if (!after || after.refcount <= 0) {
              await tx
                .delete(pgDaemonWorkspaces)
                .where(
                  eq(pgDaemonWorkspaces.workspaceId, workspace.workspaceId),
                )
                .execute();
              orphaned.push(workspace);
            }
          }
        }
        return { out: reaped, releasable: orphaned };
      });
      cleanupReapedSessions(out);
      cleanupReleasableWorkspaces(releasable);
      return out;
    } catch (error) {
      throw error instanceof DaemonSlotRegistryError
        ? error
        : new DaemonSlotRegistryError('reap expired postgres slots', error);
    }
  }

  private async initialize(): Promise<void> {
    await this.withDb('initialize postgres schema', () =>
      runPgMigrations(this.pool),
    );
  }

  private async lookupSession(
    slot: Pick<
      DaemonSlotRecord,
      'agentName' | 'provider' | 'model' | 'slotKey'
    >,
  ): Promise<DaemonSlotSessionRecord | null> {
    const [session] = await this.withDb('select postgres slot session', () =>
      this.db
        .select()
        .from(pgDaemonSlotSessions)
        .where(pgSlotSessionIdentityWhere(slot, slot.slotKey))
        .limit(1)
        .execute(),
    );
    return session ?? null;
  }

  private async lookupWorkspace(
    slot: Pick<DaemonSlotRecord, 'workspaceId'>,
  ): Promise<DaemonSlotWorkspaceRecord | null> {
    if (!slot.workspaceId) return null;
    const [workspace] = await this.withDb('select postgres workspace', () =>
      this.db
        .select()
        .from(pgDaemonWorkspaces)
        .where(eq(pgDaemonWorkspaces.workspaceId, slot.workspaceId as string))
        .limit(1)
        .execute(),
    );
    return workspace ?? null;
  }

  private async withDb<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw new DaemonSlotRegistryError(operation, error);
    }
  }
}

export function resolveLatestPiSessionPath(sessionDir: string): string | null {
  try {
    const latestEntry = readdirSync(sessionDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name)
      .sort()
      .at(-1);
    return latestEntry ? join(sessionDir, latestEntry) : null;
  } catch {
    return null;
  }
}

export function resolveDaemonStateStorageConfig(
  sqlitePath: string,
  databaseUrl?: string,
): DaemonStateStorageConfig {
  if (!databaseUrl) return { kind: 'sqlite', path: sqlitePath };
  if (
    databaseUrl.startsWith('postgres://') ||
    databaseUrl.startsWith('postgresql://')
  ) {
    return { connectionString: databaseUrl, kind: 'postgres' };
  }
  if (databaseUrl.startsWith('sqlite:')) {
    return { kind: 'sqlite', path: databaseUrl.slice('sqlite:'.length) };
  }
  throw new Error(
    'Unsupported daemon state database URL. Use sqlite:<path>, postgres://..., or postgresql://...',
  );
}

function sqliteSlotIdentityWhere(
  identity: DaemonSlotIdentity,
  slotKey: string,
) {
  return and(
    eq(daemonSlots.agentName, identity.agentName),
    eq(daemonSlots.provider, identity.provider),
    eq(daemonSlots.model, identity.model),
    eq(daemonSlots.slotKey, slotKey),
  );
}

function sqliteSlotSessionIdentityWhere(
  identity: DaemonSlotIdentity,
  slotKey: string,
) {
  return and(
    eq(daemonSlotSessions.agentName, identity.agentName),
    eq(daemonSlotSessions.provider, identity.provider),
    eq(daemonSlotSessions.model, identity.model),
    eq(daemonSlotSessions.slotKey, slotKey),
  );
}

function pgSlotIdentityWhere(identity: DaemonSlotIdentity, slotKey: string) {
  return and(
    eq(pgDaemonSlots.agentName, identity.agentName),
    eq(pgDaemonSlots.provider, identity.provider),
    eq(pgDaemonSlots.model, identity.model),
    eq(pgDaemonSlots.slotKey, slotKey),
  );
}

function pgSlotSessionIdentityWhere(
  identity: DaemonSlotIdentity,
  slotKey: string,
) {
  return and(
    eq(pgDaemonSlotSessions.agentName, identity.agentName),
    eq(pgDaemonSlotSessions.provider, identity.provider),
    eq(pgDaemonSlotSessions.model, identity.model),
    eq(pgDaemonSlotSessions.slotKey, slotKey),
  );
}

/** Remove the persisted Pi session dir for each reaped slot. */
function cleanupReapedSessions(slots: ReapedDaemonSlot[]): void {
  for (const item of slots) {
    if (item.session) {
      cleanupPiSessionDir(item.session.sessionDir);
    }
  }
}

/**
 * Remove on-disk artifacts for workspaces whose refcount reached 0. Worktrees
 * (origin/fork) are removed via `git worktree remove`; scratch workspaces are
 * plain directories removed via rm.
 */
function cleanupReleasableWorkspaces(
  workspaces: DaemonSlotWorkspaceRecord[],
): void {
  for (const ws of workspaces) {
    if (ws.kind === 'scratch') {
      rmSync(ws.worktreePath, { recursive: true, force: true });
    } else {
      cleanupReusableWorktree(ws.worktreePath);
    }
  }
}

function cleanupPiSessionDir(sessionDir: string): void {
  rmSync(sessionDir, { recursive: true, force: true });
}

function cleanupReusableWorktree(worktreePath: string): void {
  const mainRepo = findMainWorktree();
  const registered = isRegisteredWorktree(mainRepo, worktreePath);
  if (registered) {
    execFileSync(
      'git',
      ['-C', mainRepo, 'worktree', 'remove', '--force', worktreePath],
      { stdio: 'pipe' },
    );
    return;
  }

  rmSync(worktreePath, { recursive: true, force: true });
}

function findMainWorktree(): string {
  const list = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  for (const block of list.split('\n\n')) {
    const lines = block.split('\n');
    if (lines.includes('bare')) continue;
    const worktreeLine = lines.find((line) => line.startsWith('worktree '));
    if (worktreeLine) return worktreeLine.slice('worktree '.length);
  }
  throw new Error('Could not find main git worktree');
}

function isRegisteredWorktree(mainRepo: string, worktreeDir: string): boolean {
  const list = execFileSync(
    'git',
    ['-C', mainRepo, 'worktree', 'list', '--porcelain'],
    { encoding: 'utf8', stdio: 'pipe' },
  );
  const marker = `worktree ${worktreeDir}\n`;
  return list.includes(marker) || list.endsWith(`worktree ${worktreeDir}`);
}
