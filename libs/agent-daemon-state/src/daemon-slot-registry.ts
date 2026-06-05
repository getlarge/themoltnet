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

import {
  pgAgentDaemonStateSchema,
  pgDaemonSlots,
  pgDaemonSlotSessions,
  pgDaemonSlotWorkspaces,
} from './pg-schema.js';
import {
  agentDaemonStateSchema,
  daemonSlots,
  daemonSlotSessions,
  daemonSlotWorkspaces,
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
  createdAtMs: number;
  lastUsedAtMs: number;
  expiresAtMs: number;
}

export interface DaemonSlotSessionRecord extends DaemonSlotIdentity {
  slotKey: string;
  sessionDir: string;
  sessionPath: string | null;
}

export interface DaemonSlotWorkspaceRecord extends DaemonSlotIdentity {
  slotKey: string;
  workspaceId: string;
  worktreePath: string;
  worktreeBranch: string | null;
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
        this.client.exec(`
          CREATE TABLE IF NOT EXISTS daemon_slots (
            agent_name TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            slot_key TEXT NOT NULL,
            task_type TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('active', 'idle')),
            last_task_id TEXT NOT NULL,
            last_attempt_n INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            last_used_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            PRIMARY KEY (agent_name, provider, model, slot_key)
          );

          CREATE TABLE IF NOT EXISTS daemon_slot_sessions (
            agent_name TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            slot_key TEXT NOT NULL,
            session_dir TEXT NOT NULL UNIQUE,
            session_path TEXT,
            PRIMARY KEY (agent_name, provider, model, slot_key),
            FOREIGN KEY (agent_name, provider, model, slot_key)
              REFERENCES daemon_slots(agent_name, provider, model, slot_key)
              ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS daemon_slot_workspaces (
            agent_name TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            slot_key TEXT NOT NULL,
            workspace_id TEXT NOT NULL UNIQUE,
            worktree_path TEXT NOT NULL,
            worktree_branch TEXT,
            PRIMARY KEY (agent_name, provider, model, slot_key),
            FOREIGN KEY (agent_name, provider, model, slot_key)
              REFERENCES daemon_slots(agent_name, provider, model, slot_key)
              ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS daemon_slots_expires_idx
            ON daemon_slots (expires_at_ms);

          CREATE INDEX IF NOT EXISTS daemon_slots_task_attempt_idx
            ON daemon_slots (
              last_task_id,
              last_attempt_n,
              last_used_at_ms DESC
            );
        `);
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

    await this.withDb('upsert sqlite slot', () =>
      this.db
        .insert(daemonSlots)
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
        })
        .onConflictDoUpdate({
          set: {
            expiresAtMs: sql`excluded.expires_at_ms`,
            lastAttemptN: sql`excluded.last_attempt_n`,
            lastTaskId: sql`excluded.last_task_id`,
            lastUsedAtMs: sql`excluded.last_used_at_ms`,
            state: 'active',
            taskType: sql`excluded.task_type`,
          },
          target: [
            daemonSlots.agentName,
            daemonSlots.provider,
            daemonSlots.model,
            daemonSlots.slotKey,
          ],
        })
        .run(),
    );

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

    const workspaceId = input.workspaceId;
    const worktreePath = input.worktreePath;
    if (workspaceId !== null && worktreePath !== null) {
      await this.withDb('upsert sqlite slot workspace', () =>
        this.db
          .insert(daemonSlotWorkspaces)
          .values({
            agentName: input.agentName,
            model: input.model,
            provider: input.provider,
            slotKey: input.slotKey,
            workspaceId,
            worktreeBranch: input.worktreeBranch,
            worktreePath,
          })
          .onConflictDoUpdate({
            set: {
              workspaceId: sql`excluded.workspace_id`,
              worktreeBranch: sql`excluded.worktree_branch`,
              worktreePath: sql`excluded.worktree_path`,
            },
            target: [
              daemonSlotWorkspaces.agentName,
              daemonSlotWorkspaces.provider,
              daemonSlotWorkspaces.model,
              daemonSlotWorkspaces.slotKey,
            ],
          })
          .run(),
      );
    }
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

      this.withSyncDb('delete expired sqlite slots', () => {
        this.client.exec('BEGIN IMMEDIATE');
        try {
          for (const slot of slots) {
            this.client
              .prepare(
                `DELETE FROM daemon_slots
                 WHERE agent_name = ? AND provider = ? AND model = ?
                   AND slot_key = ?`,
              )
              .run(slot.agentName, slot.provider, slot.model, slot.slotKey);
          }
          this.client.exec('COMMIT');
        } catch (error) {
          try {
            this.client.exec('ROLLBACK');
          } catch {
            // Ignore rollback failures and surface the original error.
          }
          throw error;
        }
      });

      return cleanupReapedSlots(out);
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
    slot: Pick<
      DaemonSlotRecord,
      'agentName' | 'provider' | 'model' | 'slotKey'
    >,
  ): Promise<DaemonSlotWorkspaceRecord | null> {
    return this.withDb(
      'select sqlite slot workspace',
      async () =>
        (await this.db
          .select()
          .from(daemonSlotWorkspaces)
          .where(sqliteSlotWorkspaceIdentityWhere(slot, slot.slotKey))
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

    await this.withDb('upsert postgres slot', () =>
      this.db
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
        })
        .onConflictDoUpdate({
          set: {
            expiresAtMs: sql`excluded.expires_at_ms`,
            lastAttemptN: sql`excluded.last_attempt_n`,
            lastTaskId: sql`excluded.last_task_id`,
            lastUsedAtMs: sql`excluded.last_used_at_ms`,
            state: 'active',
            taskType: sql`excluded.task_type`,
          },
          target: [
            pgDaemonSlots.agentName,
            pgDaemonSlots.provider,
            pgDaemonSlots.model,
            pgDaemonSlots.slotKey,
          ],
        })
        .execute(),
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

    const workspaceId = input.workspaceId;
    const worktreePath = input.worktreePath;
    if (workspaceId !== null && worktreePath !== null) {
      await this.withDb('upsert postgres slot workspace', () =>
        this.db
          .insert(pgDaemonSlotWorkspaces)
          .values({
            agentName: input.agentName,
            model: input.model,
            provider: input.provider,
            slotKey: input.slotKey,
            workspaceId,
            worktreeBranch: input.worktreeBranch,
            worktreePath,
          })
          .onConflictDoUpdate({
            set: {
              workspaceId: sql`excluded.workspace_id`,
              worktreeBranch: sql`excluded.worktree_branch`,
              worktreePath: sql`excluded.worktree_path`,
            },
            target: [
              pgDaemonSlotWorkspaces.agentName,
              pgDaemonSlotWorkspaces.provider,
              pgDaemonSlotWorkspaces.model,
              pgDaemonSlotWorkspaces.slotKey,
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
      const out = await this.db.transaction(async (tx) => {
        const slots = await tx
          .select()
          .from(pgDaemonSlots)
          .where(lte(pgDaemonSlots.expiresAtMs, now))
          .execute();
        const reaped: ReapedDaemonSlot[] = [];
        for (const slot of slots) {
          const [session = null] = await tx
            .select()
            .from(pgDaemonSlotSessions)
            .where(pgSlotSessionIdentityWhere(slot, slot.slotKey))
            .limit(1)
            .execute();
          const [workspace = null] = await tx
            .select()
            .from(pgDaemonSlotWorkspaces)
            .where(pgSlotWorkspaceIdentityWhere(slot, slot.slotKey))
            .limit(1)
            .execute();
          reaped.push({ session, slot, workspace });
          await tx
            .delete(pgDaemonSlots)
            .where(pgSlotIdentityWhere(slot, slot.slotKey))
            .execute();
        }
        return reaped;
      });
      return cleanupReapedSlots(out);
    } catch (error) {
      throw error instanceof DaemonSlotRegistryError
        ? error
        : new DaemonSlotRegistryError('reap expired postgres slots', error);
    }
  }

  private async initialize(): Promise<void> {
    await this.withDb('initialize postgres schema', () =>
      this.pool.query(`
        CREATE TABLE IF NOT EXISTS daemon_slots (
          agent_name TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          slot_key TEXT NOT NULL,
          task_type TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('active', 'idle')),
          last_task_id TEXT NOT NULL,
          last_attempt_n INTEGER NOT NULL,
          created_at_ms BIGINT NOT NULL,
          last_used_at_ms BIGINT NOT NULL,
          expires_at_ms BIGINT NOT NULL,
          PRIMARY KEY (agent_name, provider, model, slot_key)
        );

        CREATE TABLE IF NOT EXISTS daemon_slot_sessions (
          agent_name TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          slot_key TEXT NOT NULL,
          session_dir TEXT NOT NULL UNIQUE,
          session_path TEXT,
          PRIMARY KEY (agent_name, provider, model, slot_key),
          FOREIGN KEY (agent_name, provider, model, slot_key)
            REFERENCES daemon_slots(agent_name, provider, model, slot_key)
            ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS daemon_slot_workspaces (
          agent_name TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          slot_key TEXT NOT NULL,
          workspace_id TEXT NOT NULL UNIQUE,
          worktree_path TEXT NOT NULL,
          worktree_branch TEXT,
          PRIMARY KEY (agent_name, provider, model, slot_key),
          FOREIGN KEY (agent_name, provider, model, slot_key)
            REFERENCES daemon_slots(agent_name, provider, model, slot_key)
            ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS daemon_slots_expires_idx
          ON daemon_slots (expires_at_ms);

        CREATE INDEX IF NOT EXISTS daemon_slots_task_attempt_idx
          ON daemon_slots (
            last_task_id,
            last_attempt_n,
            last_used_at_ms DESC
          );

        ALTER TABLE daemon_slots
          ALTER COLUMN created_at_ms TYPE BIGINT,
          ALTER COLUMN last_used_at_ms TYPE BIGINT,
          ALTER COLUMN expires_at_ms TYPE BIGINT;
      `),
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
    slot: Pick<
      DaemonSlotRecord,
      'agentName' | 'provider' | 'model' | 'slotKey'
    >,
  ): Promise<DaemonSlotWorkspaceRecord | null> {
    const [workspace] = await this.withDb(
      'select postgres slot workspace',
      () =>
        this.db
          .select()
          .from(pgDaemonSlotWorkspaces)
          .where(pgSlotWorkspaceIdentityWhere(slot, slot.slotKey))
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

function sqliteSlotWorkspaceIdentityWhere(
  identity: DaemonSlotIdentity,
  slotKey: string,
) {
  return and(
    eq(daemonSlotWorkspaces.agentName, identity.agentName),
    eq(daemonSlotWorkspaces.provider, identity.provider),
    eq(daemonSlotWorkspaces.model, identity.model),
    eq(daemonSlotWorkspaces.slotKey, slotKey),
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

function pgSlotWorkspaceIdentityWhere(
  identity: DaemonSlotIdentity,
  slotKey: string,
) {
  return and(
    eq(pgDaemonSlotWorkspaces.agentName, identity.agentName),
    eq(pgDaemonSlotWorkspaces.provider, identity.provider),
    eq(pgDaemonSlotWorkspaces.model, identity.model),
    eq(pgDaemonSlotWorkspaces.slotKey, slotKey),
  );
}

function cleanupReapedSlots(slots: ReapedDaemonSlot[]): ReapedDaemonSlot[] {
  for (const item of slots) {
    if (item.session) {
      cleanupPiSessionDir(item.session.sessionDir);
    }
    if (item.workspace) {
      cleanupReusableWorktree(item.workspace.worktreePath);
    }
  }
  return slots;
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
