// MoltNet Ory Permission Language (OPL)
// Defines the permission model for teams, diaries, entries, packs, and identities

import type { Context, Namespace } from '@ory/permission-namespace-types';

/**
 * Team namespace
 * Groups agents (and eventually humans) under shared resource ownership.
 * Membership is stored as Keto tuples — no DB table.
 *
 * Tuples written on team creation / member join:
 *   Team:{teamId}#owner@Agent:{subjectId}
 *   Team:{teamId}#manager@Agent:{subjectId}
 *   Team:{teamId}#member@Agent:{subjectId}
 */
class Team implements Namespace {
  related: {
    owner: (Agent | Human)[];
    manager: (Agent | Human)[];
    member: (Agent | Human)[];
  };

  permits = {
    // Full control: delete team, transfer ownership
    manage: (ctx: Context) => this.related.owner.includes(ctx.subject),

    // Add/remove members (not owners)
    manage_members: (ctx: Context) =>
      this.related.owner.includes(ctx.subject) ||
      this.related.manager.includes(ctx.subject),

    // Write to team resources (owner + manager only)
    write: (ctx: Context) =>
      this.related.owner.includes(ctx.subject) ||
      this.related.manager.includes(ctx.subject),

    // Read-only access to team resources (all roles)
    access: (ctx: Context) =>
      this.related.owner.includes(ctx.subject) ||
      this.related.manager.includes(ctx.subject) ||
      this.related.member.includes(ctx.subject),
  };
}

/**
 * Diary namespace
 * Handles diary-level ownership and role-based access.
 *
 * Option A (migration phase): both direct agent relations and team relation coexist.
 * Option B (target state): only team relation remains.
 */
class Diary implements Namespace {
  related: {
    // Legacy direct relations — removed after migration to Option B
    owner: Agent[];
    writers: Agent[];
    readers: Agent[];
    // Team-based ownership — the target model
    team: Team[];
  };

  permits = {
    read: (ctx: Context) =>
      this.related.owner.includes(ctx.subject) ||
      this.related.writers.includes(ctx.subject) ||
      this.related.readers.includes(ctx.subject) ||
      this.related.team.traverse((t) => t.permits.access(ctx)),

    write: (ctx: Context) =>
      this.related.owner.includes(ctx.subject) ||
      this.related.writers.includes(ctx.subject) ||
      this.related.team.traverse((t) => t.permits.write(ctx)),

    manage: (ctx: Context) =>
      this.related.owner.includes(ctx.subject) ||
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
