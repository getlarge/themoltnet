// MoltNet Ory Permission Language (OPL)
// Defines the permission model for teams, diaries, entries, packs, and identities

import type { Context, Namespace } from '@ory/permission-namespace-types';

/**
 * Team namespace
 * Groups agents (and eventually humans) under shared resource ownership.
 * Membership is stored as Keto tuples — no DB table.
 *
 * Tuples written on team creation / member join:
 *   Team:{teamId}#owners@Agent:{subjectId}
 *   Team:{teamId}#managers@Agent:{subjectId}
 *   Team:{teamId}#members@Agent:{subjectId}
 */
class Team implements Namespace {
  related: {
    owners: (Agent | Human)[];
    managers: (Agent | Human)[];
    members: (Agent | Human)[];
  };

  permits = {
    // Full control: delete team, transfer ownership
    manage: (ctx: Context) => this.related.owners.includes(ctx.subject),

    // Add/remove members (not owners)
    manage_members: (ctx: Context) =>
      this.related.owners.includes(ctx.subject) ||
      this.related.managers.includes(ctx.subject),

    // Write to team resources (owner + manager only)
    write: (ctx: Context) =>
      this.related.owners.includes(ctx.subject) ||
      this.related.managers.includes(ctx.subject),

    // Read-only access to team resources (all roles)
    access: (ctx: Context) =>
      this.related.owners.includes(ctx.subject) ||
      this.related.managers.includes(ctx.subject) ||
      this.related.members.includes(ctx.subject),
  };
}

/**
 * Group namespace
 * Named subsets of team members. Used for fine-grained diary grants (Chunk 3).
 * Management is inherited from the parent team — team owners/managers manage all groups.
 *
 * Tuples written on group creation:
 *   Group:{groupId}#parent@Team:{teamId}
 * Tuples written on member add:
 *   Group:{groupId}#members@Agent:{subjectId}
 *   Group:{groupId}#members@Human:{subjectId}
 */
class Group implements Namespace {
  related: {
    members: (Agent | Human)[];
    parent: Team[];
  };

  permits = {
    // Management delegated to team owners/managers
    manage: (ctx: Context) =>
      this.related.parent.traverse((t) => t.permits.manage_members(ctx)),

    // Membership check (used by diary grants in Chunk 3)
    access: (ctx: Context) => this.related.members.includes(ctx.subject),
  };
}

/**
 * Diary namespace
 * Handles diary-level access via team membership and optional per-diary grants.
 *
 * Primary access path: Diary → Team → subject role check
 * Secondary (chunk 3): direct writers/managers grants for fine-grained control
 */
class Diary implements Namespace {
  related: {
    // Team-based ownership — primary access path
    team: Team[];
    // Per-diary grants (chunk 3 routes — forward-declared)
    writers: (Agent | Human | SubjectSet<Group, 'members'>)[];
    managers: (Agent | Human | SubjectSet<Group, 'members'>)[];
  };

  permits = {
    read: (ctx: Context) =>
      this.related.writers.includes(ctx.subject) ||
      this.related.managers.includes(ctx.subject) ||
      this.related.team.traverse((t) => t.permits.access(ctx)),
    write: (ctx: Context) =>
      this.related.writers.includes(ctx.subject) ||
      this.related.managers.includes(ctx.subject) ||
      this.related.team.traverse((t) => t.permits.write(ctx)),
    manage: (ctx: Context) =>
      this.related.managers.includes(ctx.subject) ||
      this.related.team.traverse((t) => t.permits.manage(ctx)),
  };
}

/**
 * DiaryEntry namespace
 * Permissions are inherited transitively from the parent Diary.
 * The sole relation is `parent: Diary[]` — one entry belongs to one diary.
 *
 * Transitive path: DiaryEntry → Diary → Team (3 hops max)
 */
class DiaryEntry implements Namespace {
  related: {
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
 * ContextPack namespace
 * Permissions are inherited transitively from the parent Diary.
 *
 * Transitive path: ContextPack → Diary → Team (3 hops max)
 */
class ContextPack implements Namespace {
  related: {
    parent: Diary[];
  };

  permits = {
    read: (ctx: Context) =>
      this.related.parent.traverse((d) => d.permits.read(ctx)),
    manage: (ctx: Context) =>
      this.related.parent.traverse((d) => d.permits.manage(ctx)),
  };
}

/**
 * Agent namespace
 * Represents MoltNet agents and their identity ownership.
 */
class Agent implements Namespace {
  related: {
    self: Agent[];
  };

  permits = {
    act_as: (ctx: Context) => this.related.self.includes(ctx.subject),
  };
}

/**
 * Human namespace
 * Represents human users. Symmetric with Agent — no implicit privileges.
 */
class Human implements Namespace {
  related: {
    self: Human[];
  };

  permits = {
    act_as: (ctx: Context) => this.related.self.includes(ctx.subject),
  };
}
