import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

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
    createdAtMs: integer('created_at_ms').notNull(),
    lastUsedAtMs: integer('last_used_at_ms').notNull(),
    expiresAtMs: integer('expires_at_ms').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.agentName, table.provider, table.model, table.slotKey],
    }),
    index('daemon_slots_expires_idx').on(table.expiresAtMs),
    index('daemon_slots_task_attempt_idx').on(
      table.lastTaskId,
      table.lastAttemptN,
      table.lastUsedAtMs,
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
  ],
);

export const daemonSlotWorkspaces = sqliteTable(
  'daemon_slot_workspaces',
  {
    agentName: text('agent_name').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    slotKey: text('slot_key').notNull(),
    workspaceId: text('workspace_id').notNull().unique(),
    worktreePath: text('worktree_path').notNull(),
    worktreeBranch: text('worktree_branch'),
  },
  (table) => [
    primaryKey({
      columns: [table.agentName, table.provider, table.model, table.slotKey],
    }),
  ],
);

export const agentDaemonStateSchema = {
  daemonSlotSessions,
  daemonSlotWorkspaces,
  daemonSlots,
};
