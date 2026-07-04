export function buildProactiveMemoryWorkflowBlock(): string {
  return [
    'Before material work, query MoltNet memory instead of waiting for a',
    'human prompt. Keep searches constrained; do not search randomly:',
    '',
    '- Use `moltnet_diary_tags` to discover likely `scope:*`, `incident`,',
    '  `decision`, and task provenance tags.',
    '- Use `moltnet_list_entries` when tags, task ids, correlation ids, or',
    '  entry ids are known.',
    '- Use `moltnet_search_entries` for semantic matches against the brief,',
    '  error text, subsystem, root cause, proposed fix, or review subject.',
    '  Always pass narrowing filters when available: `taskFilter` for the',
    '  current task/correlation lineage, `entryTypes` for decision/incident',
    '  searches, and `tags` such as `scope:<area>`, `incident`, or `decision`',
    '  discovered from `moltnet_diary_tags`.',
    '- Before creating any `episodic` incident entry, search for similar',
    '  incidents first with `entryTypes: ["episodic", "semantic"]` plus the',
    '  relevant `scope:*` or task provenance filters. If a close match exists,',
    '  reference that entry instead of creating an isolated duplicate; create',
    '  a recurrence entry only when the repeat occurrence is itself useful',
    '  signal.',
  ].join('\n');
}
