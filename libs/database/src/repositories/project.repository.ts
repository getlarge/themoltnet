import { and, asc, eq } from 'drizzle-orm';

import type { Database } from '../db.js';
import { type Project, projects } from '../schema.js';
import { getExecutor } from '../transaction-context.js';
import { translateUniqueViolation } from '../unique-violation.js';

export type ProjectChanges = Partial<
  Pick<Project, 'name' | 'description' | 'defaultDiaryId' | 'archived'>
>;
export interface ProjectRepository {
  create(input: {
    creator: { kind: 'agent' | 'human'; id: string };
    teamId: string;
    name: string;
    description?: string | null;
    defaultDiaryId?: string | null;
  }): Promise<Project>;
  findById(id: string): Promise<Project | null>;
  listByTeamId(
    teamId: string,
    includeArchived?: boolean,
    page?: { limit: number; offset: number },
  ): Promise<Project[]>;
  update(
    id: string,
    teamId: string,
    changes: ProjectChanges,
  ): Promise<Project | null>;
}
export function createProjectRepository(db: Database): ProjectRepository {
  return {
    async create(input) {
      const { creator, ...fields } = input;
      try {
        const [project] = await getExecutor(db)
          .insert(projects)
          .values({
            ...fields,
            name: fields.name.trim(),
            creatorAgentId: creator.kind === 'agent' ? creator.id : null,
            creatorHumanId: creator.kind === 'human' ? creator.id : null,
          })
          .returning();
        return project;
      } catch (error) {
        throw (
          translateUniqueViolation(error, {
            constraint: 'projects_team_name_idx',
            target: {
              resource: 'project',
              keys: { teamId: input.teamId, name: input.name },
            },
          }) ?? error
        );
      }
    },
    async findById(id) {
      const [project] = await getExecutor(db)
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);
      return project ?? null;
    },
    async listByTeamId(
      teamId,
      includeArchived = false,
      page = { limit: 50, offset: 0 },
    ) {
      return getExecutor(db)
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.teamId, teamId),
            includeArchived ? undefined : eq(projects.archived, false),
          ),
        )
        .orderBy(asc(projects.name), asc(projects.id))
        .limit(page.limit)
        .offset(page.offset);
    },
    async update(id, teamId, changes) {
      try {
        // Explicit allowlist keeps team ownership immutable at the persistence seam.
        const [project] = await getExecutor(db)
          .update(projects)
          .set({
            name: changes.name?.trim(),
            description: changes.description,
            defaultDiaryId: changes.defaultDiaryId,
            archived: changes.archived,
            updatedAt: new Date(),
          })
          .where(and(eq(projects.id, id), eq(projects.teamId, teamId)))
          .returning();
        return project ?? null;
      } catch (error) {
        throw (
          translateUniqueViolation(error, {
            constraint: 'projects_team_name_idx',
            target: {
              resource: 'project',
              keys: { teamId, ...(changes.name ? { name: changes.name } : {}) },
            },
          }) ?? error
        );
      }
    },
  };
}
