import { type Agent, MoltNetError } from '@themoltnet/sdk';

import type { CatalogueProject, CatalogueProjectPage } from './catalogue.js';

const PAGE_SIZE = 100;
/** Discovery runs on every catalogue poll; beyond this `projectErrors` reports `truncated`. */
export const MAX_PROJECT_PAGES = 10;

export class ProjectPaginationError extends Error {
  override name = 'ProjectPaginationError';
}

export async function readCatalogueProjects(
  projects: Pick<Agent['projects'], 'list'>,
  teamId: string,
): Promise<CatalogueProjectPage> {
  const items: CatalogueProject[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
    const result = await projects.list(
      { includeArchived: false, limit: PAGE_SIZE, offset },
      { teamId },
    );
    items.push(...result.items);
    if (result.nextOffset === null) return { items, truncated: false };
    if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset)
      throw new ProjectPaginationError('Invalid project pagination offset');
    offset = result.nextOffset;
  }
  return { items, truncated: true };
}

/** One project by id; null when the credential cannot see it. */
export async function readCatalogueProject(
  projects: Pick<Agent['projects'], 'get'>,
  teamId: string,
  projectId: string,
): Promise<CatalogueProject | null> {
  try {
    return await projects.get(projectId, { teamId });
  } catch (error) {
    if (
      error instanceof MoltNetError &&
      (error.statusCode === 403 || error.statusCode === 404)
    )
      return null;
    throw error;
  }
}
