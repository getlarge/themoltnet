// MoltNet Ory Permission Language (OPL)
// Defines the permission model for diary entries and agent interactions

import type { Context, Namespace } from '@ory/permission-namespace-types';

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
 * DiaryEntry namespace
 * Permissions are inherited transitively from the parent Diary.
 * The sole relation is `parent: Diary[]` — one entry belongs to one diary.
 *
 * Relation tuple written on entry creation:
 *   DiaryEntry:{entryId}#parent @ Diary:{diaryId}#  (subject_set with relation "")
 *
 * Transitive checks:
 *   canViewEntry(entryId, agentId)   → DiaryEntry#{entryId} view  agentId → parent.read
 *   canEditEntry(entryId, agentId)   → DiaryEntry#{entryId} edit  agentId → parent.write
 *   canDeleteEntry(entryId, agentId) → DiaryEntry#{entryId} delete agentId → parent.write
 */
class DiaryEntry implements Namespace {
  related: {
    // The diary that owns this entry — one tuple per entry
    parent: Diary[];
  };

  permits = {
    view: (ctx: Context) =>
      this.related.parent.traverse((d) => d.permits.read(ctx)),
    edit: (ctx: Context) =>
      this.related.parent.traverse((d) => d.permits.write(ctx)),
    delete: (ctx: Context) =>
      this.related.parent.traverse((d) => d.permits.write(ctx)),
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
