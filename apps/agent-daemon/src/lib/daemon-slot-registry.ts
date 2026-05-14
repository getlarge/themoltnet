import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { findMainWorktree } from '@themoltnet/pi-extension';

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

export class DaemonSlotRegistry {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    try {
      this.db = new DatabaseSync(dbPath);
      this.withDb('initialize schema', () => {
        this.db.exec(`
      PRAGMA journal_mode = WAL;

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
        `);
      });
    } catch (error) {
      throw new DaemonSlotRegistryError('open database', error);
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch (error) {
      throw new DaemonSlotRegistryError('close database', error);
    }
  }

  beginSlot(input: DaemonSlotStartInput): void {
    const now = Date.now();
    const expiresAtMs = now + input.ttlSec * 1000;

    this.withDb('upsert slot', () =>
      this.db
        .prepare(
          `INSERT INTO daemon_slots (
           agent_name, provider, model, slot_key, task_type, state,
           last_task_id, last_attempt_n, created_at_ms, last_used_at_ms,
           expires_at_ms
         ) VALUES (
           :agentName, :provider, :model, :slotKey, :taskType, 'active',
           :lastTaskId, :lastAttemptN, :createdAtMs, :lastUsedAtMs,
           :expiresAtMs
         )
         ON CONFLICT(agent_name, provider, model, slot_key) DO UPDATE SET
           task_type = excluded.task_type,
           state = 'active',
           last_task_id = excluded.last_task_id,
           last_attempt_n = excluded.last_attempt_n,
           last_used_at_ms = excluded.last_used_at_ms,
           expires_at_ms = excluded.expires_at_ms`,
        )
        .run({
          agentName: input.agentName,
          provider: input.provider,
          model: input.model,
          slotKey: input.slotKey,
          taskType: input.taskType,
          lastTaskId: input.lastTaskId,
          lastAttemptN: input.lastAttemptN,
          createdAtMs: now,
          lastUsedAtMs: now,
          expiresAtMs,
        }),
    );

    if (input.sessionDir) {
      this.withDb('upsert slot session', () =>
        this.db
          .prepare(
            `INSERT INTO daemon_slot_sessions (
             agent_name, provider, model, slot_key, session_dir, session_path
           ) VALUES (
             :agentName, :provider, :model, :slotKey, :sessionDir, :sessionPath
           )
           ON CONFLICT(agent_name, provider, model, slot_key) DO UPDATE SET
             session_dir = excluded.session_dir,
             session_path = excluded.session_path`,
          )
          .run({
            agentName: input.agentName,
            provider: input.provider,
            model: input.model,
            slotKey: input.slotKey,
            sessionDir: input.sessionDir,
            sessionPath: input.sessionPath,
          }),
      );
    }

    if (input.workspaceId && input.worktreePath) {
      this.withDb('upsert slot workspace', () =>
        this.db
          .prepare(
            `INSERT INTO daemon_slot_workspaces (
             agent_name, provider, model, slot_key, workspace_id, worktree_path,
             worktree_branch
           ) VALUES (
             :agentName, :provider, :model, :slotKey, :workspaceId, :worktreePath,
             :worktreeBranch
           )
           ON CONFLICT(agent_name, provider, model, slot_key) DO UPDATE SET
             workspace_id = excluded.workspace_id,
             worktree_path = excluded.worktree_path,
             worktree_branch = excluded.worktree_branch`,
          )
          .run({
            agentName: input.agentName,
            provider: input.provider,
            model: input.model,
            slotKey: input.slotKey,
            workspaceId: input.workspaceId,
            worktreePath: input.worktreePath,
            worktreeBranch: input.worktreeBranch,
          }),
      );
    }
  }

  finishSlot(
    identity: DaemonSlotIdentity,
    slotKey: string,
    ttlSec: number,
    sessionPath: string | null,
  ): void {
    const now = Date.now();
    this.withDb('finish slot', () =>
      this.db
        .prepare(
          `UPDATE daemon_slots
           SET state = 'idle',
               last_used_at_ms = ?,
               expires_at_ms = ?
         WHERE agent_name = ? AND provider = ? AND model = ? AND slot_key = ?`,
        )
        .run(
          now,
          now + ttlSec * 1000,
          identity.agentName,
          identity.provider,
          identity.model,
          slotKey,
        ),
    );

    if (sessionPath !== null) {
      this.withDb('update slot session path', () =>
        this.db
          .prepare(
            `UPDATE daemon_slot_sessions
             SET session_path = ?
           WHERE agent_name = ? AND provider = ? AND model = ? AND slot_key = ?`,
          )
          .run(
            sessionPath,
            identity.agentName,
            identity.provider,
            identity.model,
            slotKey,
          ),
      );
    }
  }

  reapExpiredSlots(now = Date.now()): ReapedDaemonSlot[] {
    this.withDb('begin reap transaction', () =>
      this.db.exec('BEGIN IMMEDIATE'),
    );
    try {
      const slots = this.withDb(
        'select expired slots',
        () =>
          this.db
            .prepare(
              `SELECT
             agent_name as agentName,
             provider,
             model,
             slot_key as slotKey,
             task_type as taskType,
             state,
             last_task_id as lastTaskId,
             last_attempt_n as lastAttemptN,
             created_at_ms as createdAtMs,
             last_used_at_ms as lastUsedAtMs,
             expires_at_ms as expiresAtMs
           FROM daemon_slots
           WHERE expires_at_ms <= ?`,
            )
            .all(now) as unknown as DaemonSlotRecord[],
      );

      if (slots.length < 1) {
        this.withDb('commit empty reap transaction', () =>
          this.db.exec('COMMIT'),
        );
        return [];
      }

      const selectSession = this.withDb('prepare slot session lookup', () =>
        this.db.prepare(
          `SELECT
             agent_name as agentName,
             provider,
             model,
             slot_key as slotKey,
             session_dir as sessionDir,
             session_path as sessionPath
           FROM daemon_slot_sessions
           WHERE agent_name = ? AND provider = ? AND model = ? AND slot_key = ?`,
        ),
      );
      const selectWorkspace = this.withDb('prepare slot workspace lookup', () =>
        this.db.prepare(
          `SELECT
               agent_name as agentName,
               provider,
               model,
               slot_key as slotKey,
               workspace_id as workspaceId,
               worktree_path as worktreePath,
               worktree_branch as worktreeBranch
             FROM daemon_slot_workspaces
             WHERE agent_name = ? AND provider = ? AND model = ? AND slot_key = ?`,
        ),
      );
      const deleteStmt = this.withDb('prepare expired slot delete', () =>
        this.db.prepare(
          'DELETE FROM daemon_slots WHERE agent_name = ? AND provider = ? AND model = ? AND slot_key = ?',
        ),
      );

      const out: ReapedDaemonSlot[] = [];
      for (const slot of slots) {
        const session = this.withDb(
          'select slot session',
          () =>
            (selectSession.get(
              slot.agentName,
              slot.provider,
              slot.model,
              slot.slotKey,
            ) ?? null) as unknown as DaemonSlotSessionRecord | null,
        );
        const workspace = this.withDb(
          'select slot workspace',
          () =>
            (selectWorkspace.get(
              slot.agentName,
              slot.provider,
              slot.model,
              slot.slotKey,
            ) ?? null) as unknown as DaemonSlotWorkspaceRecord | null,
        );
        out.push({ slot, session, workspace });
        this.withDb('delete expired slot', () =>
          deleteStmt.run(
            slot.agentName,
            slot.provider,
            slot.model,
            slot.slotKey,
          ),
        );
      }

      this.withDb('commit reap transaction', () => this.db.exec('COMMIT'));

      for (const item of out) {
        if (item.session) cleanupPiSessionDir(item.session.sessionDir);
        if (item.workspace)
          cleanupReusableWorktree(item.workspace.worktreePath);
      }

      return out;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures and surface the original error.
      }
      throw error instanceof DaemonSlotRegistryError
        ? error
        : new DaemonSlotRegistryError('reap expired slots', error);
    }
  }

  private withDb<T>(operation: string, fn: () => T): T {
    try {
      return fn();
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

function isRegisteredWorktree(mainRepo: string, worktreeDir: string): boolean {
  const list = execFileSync(
    'git',
    ['-C', mainRepo, 'worktree', 'list', '--porcelain'],
    { encoding: 'utf8', stdio: 'pipe' },
  );
  const marker = `worktree ${worktreeDir}\n`;
  return list.includes(marker) || list.endsWith(`worktree ${worktreeDir}`);
}
