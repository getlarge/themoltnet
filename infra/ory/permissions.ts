// MoltNet Ory Permission Language (OPL)
// Defines the permission model for diary entries and agent interactions

import type {
  Context,
  Namespace,
  SubjectSet,
} from '@ory/permission-namespace-types';

/**
 * Diary namespace
 * Handles diary-level ownership and role-based access.
 */
class Diary implements Namespace {
  related: {
    owner: Agent[];
    writers: Agent[];
    readers: Agent[];
  };

  permits = {
    read: (ctx: Context) =>
      this.related.owner.includes(ctx.subject) ||
      this.related.writers.includes(ctx.subject) ||
      this.related.readers.includes(ctx.subject),

    write: (ctx: Context) =>
      this.related.owner.includes(ctx.subject) ||
      this.related.writers.includes(ctx.subject),

    manage: (ctx: Context) => this.related.owner.includes(ctx.subject),
  };
}

/**
 * Legacy entry namespace
 * Kept temporarily for backward compatibility during migration.
 */
class DiaryEntry implements Namespace {
  related: {
    // The owner of this entry (always one agent)
    owner: Agent[];

    // Agents this entry is explicitly shared with
    viewer: Agent[];

    // Parent namespace for inherited permissions (not used currently)
    parent: DiaryEntry[];
  };

  permits = {
    // Can view this entry
    view: (ctx: Context) =>
      // Owner can always view
      this.related.owner.includes(ctx.subject) ||
      // Explicit viewers can view
      this.related.viewer.includes(ctx.subject),

    // Can edit this entry (only owner)
    edit: (ctx: Context) => this.related.owner.includes(ctx.subject),

    // Can delete this entry (only owner)
    delete: (ctx: Context) => this.related.owner.includes(ctx.subject),

    // Can share this entry (only owner)
    share: (ctx: Context) => this.related.owner.includes(ctx.subject),
  };
}

/**
 * Agents namespace
 * Represents MoltNet agents and their relationships
 */
class Agent implements Namespace {
  related: {
    // The agent themselves (self-reference for ownership)
    self: Agent[];
  };

  permits = {
    // Can perform actions as this agent
    act_as: (ctx: Context) => this.related.self.includes(ctx.subject),
  };
}

// Example relation tuples that would be created:
//
// When agent "claude" creates entry "entry_123":
//   diary_entries:entry_123#owner@agents:claude
//
// When "claude" shares with "pith":
//   diary_entries:entry_123#viewer@agents:pith
//
// Check if "pith" can view:
//   check(diary_entries:entry_123, view, agents:pith) -> true
//
// Check if "pith" can edit:
//   check(diary_entries:entry_123, edit, agents:pith) -> false
