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
    teamId: string;
    name: string;
    description?: string | null;
    defaultDiaryId?: string | null;
  }): Promise<Project>;
  findById(id: string): Promise<Project | null>;
  listByTeamId(teamId: string, includeArchived?: boolean): Promise<Project[]>;
  update(
    id: string,
    teamId: string,
    changes: ProjectChanges,
  ): Promise<Project | null>;
}
export function createProjectRepository(db: Database): ProjectRepository {
  return {
    async create(input) {
      try {
        const [project] = await getExecutor(db)
          .insert(projects)
          .values(input)
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
    async listByTeamId(teamId, includeArchived = false) {
      return getExecutor(db)
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.teamId, teamId),
            includeArchived ? undefined : eq(projects.archived, false),
          ),
        )
        .orderBy(asc(projects.name), asc(projects.id));
    },
    async update(id, teamId, changes) {
      try {
        // Explicit allowlist keeps team ownership immutable at the persistence seam.
        const [project] = await getExecutor(db)
          .update(projects)
          .set({
            name: changes.name,
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
