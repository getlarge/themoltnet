import type { Agent } from '@themoltnet/sdk';

import type { CatalogueProject } from './catalogue.js';

export async function readCatalogueProjects(
  projects: Pick<Agent['projects'], 'list'>,
  teamId: string,
): Promise<CatalogueProject[]> {
  const items: CatalogueProject[] = [];
  let offset = 0;
  for (;;) {
    const page = await projects.list(
      { includeArchived: false, limit: 100, offset },
      { teamId },
    );
    items.push(...page.items);
    if (page.nextOffset === null) return items;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset)
      throw new Error('Invalid project pagination offset');
    offset = page.nextOffset;
  }
}
