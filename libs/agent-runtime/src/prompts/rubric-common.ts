import type { Rubric } from '@moltnet/tasks';

export function renderRubricCriteriaList(rubric: Rubric): string {
  return rubric.criteria
    .map(
      (c, i) =>
        `${i + 1}. **${c.id}** (weight ${c.weight}, scoring: \`${c.scoring}\`) — ${c.description}`,
    )
    .join('\n');
}

export function renderRubricPreambleSection(rubric: Rubric): string | null {
  if (!rubric.preamble) return null;
  return ['### Rubric preamble', '', rubric.preamble, ''].join('\n');
}
