import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

// Worktree/scratch workspaces are first-class, refcounted entities shared by
// N slots (across agent profiles) that resume the same task chain. The slot ->
// workspace direction (slot.workspace_id FK) lets two profiles reference one
// branch/worktree without colliding on the workspace_id unique constraint, and
// reap decrements `refcount`, removing the worktree only when it reaches 0.
export const daemonWorkspaces = sqliteTable(
  'daemon_workspaces',
  {
    workspaceId: text('workspace_id').primaryKey(),
    worktreePath: text('worktree_path').notNull(),
    // Null for scratch_mount workspaces, which have no git branch.
    worktreeBranch: text('worktree_branch'),
    kind: text('kind', { enum: ['origin', 'fork', 'scratch'] }).notNull(),
    refcount: integer('refcount').notNull().default(0),
    createdAtMs: integer('created_at_ms').notNull(),
    lastUsedAtMs: integer('last_used_at_ms').notNull(),
  },
  (table) => [
    check(
      'daemon_workspaces_kind_check',
      sql`${table.kind} IN ('origin', 'fork', 'scratch')`,
    ),
  ],
);

export const daemonSlots = sqliteTable(
  'daemon_slots',
  {
    agentName: text('agent_name').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    slotKey: text('slot_key').notNull(),
    taskType: text('task_type').notNull(),
    state: text('state', { enum: ['active', 'idle'] }).notNull(),
    lastTaskId: text('last_task_id').notNull(),
    lastAttemptN: integer('last_attempt_n').notNull(),
    workspaceId: text('workspace_id').references(
      () => daemonWorkspaces.workspaceId,
      { onDelete: 'set null' },
    ),
    createdAtMs: integer('created_at_ms').notNull(),
    lastUsedAtMs: integer('last_used_at_ms').notNull(),
    expiresAtMs: integer('expires_at_ms').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.agentName, table.provider, table.model, table.slotKey],
    }),
    check(
      'daemon_slots_state_check',
      sql`${table.state} IN ('active', 'idle')`,
    ),
    index('daemon_slots_expires_idx').on(table.expiresAtMs),
    index('daemon_slots_task_attempt_idx').on(
      table.lastTaskId,
      table.lastAttemptN,
      sql`${table.lastUsedAtMs} DESC`,
    ),
  ],
);

export const daemonSlotSessions = sqliteTable(
  'daemon_slot_sessions',
  {
    agentName: text('agent_name').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    slotKey: text('slot_key').notNull(),
    sessionDir: text('session_dir').notNull().unique(),
    sessionPath: text('session_path'),
  },
  (table) => [
    primaryKey({
      columns: [table.agentName, table.provider, table.model, table.slotKey],
    }),
    foreignKey({
      columns: [table.agentName, table.provider, table.model, table.slotKey],
      foreignColumns: [
        daemonSlots.agentName,
        daemonSlots.provider,
        daemonSlots.model,
        daemonSlots.slotKey,
      ],
    }).onDelete('cascade'),
  ],
);

export const agentDaemonStateSchema = {
  daemonSlotSessions,
  daemonWorkspaces,
  daemonSlots,
};
