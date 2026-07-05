export function buildProactiveMemoryWorkflowBlock(): string {
  return [
    "Before material work, apply the runtime instructor's proactive memory",
    'rules instead of waiting for a human prompt. Start with constrained',
    'diary context: inspect tags/list entries when task provenance or scope',
    'tags are known, then use `moltnet_search_entries` with `taskFilter`,',
    '`entryTypes`, and tags. Do not run broad unfiltered searches before',
    'constrained searches miss.',
    '',
    'For incident capture, follow the runtime instructor exactly: search',
    'for similar episodic/semantic entries first, reference close matches,',
    'and create a recurrence entry only when the repeat is useful signal.',
  ].join('\n');
}
