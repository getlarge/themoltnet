import type { CuratePackInput } from '@moltnet/tasks';

interface Ctx {
  diaryId: string;
  taskId: string;
}

/**
 * Build the system prompt for a `curate_pack` task.
 *
 * Design note: this prompt is deliberately NOT a numbered command
 * sequence. The curator's value comes from judgment — inferring scope
 * from a fuzzy prompt, deciding whether to widen or narrow the search,
 * noticing clusters, choosing a defensible entry count. Prescribing
 * exact tool calls would waste that capability. Instead we frame the
 * goal, list the tools, describe the evidence trail we expect, and
 * leave sequencing to the model.
 *
 * TODO(#885): add a `moltnet_parallel_explore` custom tool that spawns
 * N isolated `createAgentSession` children (one per tag cluster or
 * entry_type axis the curator picks after recon), each with a narrow
 * tool subset and a turn cap, and returns compressed summaries. Parent
 * curator keeps a warm context and only sees {candidateIds, notes}
 * per probe — mirrors the fan-out pattern pi-mono SDK example #13
 * (session runtime) + #05 (custom tools) makes possible. Until that
 * lands, the `checkpoints[]` output field is the fallback: curator
 * emits pruned state at phase boundaries so a follow-up session can
 * resume without replaying the tool history.
 */
export function buildCuratePackPrompt(
  input: CuratePackInput,
  ctx: Ctx,
): string {
  const { diaryId, taskPrompt, entryTypes, tagFilters, tokenBudget, recipe } =
    input;

  // When the imposer leaves entryTypes unset, the LLM picks per-search.
  // Forcing a default at this layer has produced packs dominated by
  // procedural commit audit trails when the prompt clearly wanted
  // incident/decision narratives — see follow-up to issue #852.
  // We list the type taxonomy and let the curator choose; tag/type
  // filtering happens inside the LLM's tool calls, not as input bounds.
  const entryTypesPinned = Boolean(entryTypes);
  const resolvedRecipe = recipe ?? 'topic-focused-v1';

  const includeLine = tagFilters?.include?.length
    ? `- Hard include (ALL must be present on an entry): ${tagFilters.include.map((t) => `\`${t}\``).join(', ')}`
    : null;
  const excludeLine = tagFilters?.exclude?.length
    ? `- Hard exclude (drop if ANY present): ${tagFilters.exclude.map((t) => `\`${t}\``).join(', ')}`
    : null;
  const prefixLine = tagFilters?.prefix
    ? `- Tag prefix hint when inventorying: \`${tagFilters.prefix}\``
    : null;

  const lines: Array<string | null> = [
    '# Curate Pack Agent',
    '',
    'You are the curator. Step 1 of the three-session attribution loop:',
    'you pick and rank diary entries, another agent will render, a third',
    'will judge. Your output IS the pack — nobody downstream will re-rank.',
    '',
    `Your agent-session diary ID is: ${ctx.diaryId}`,
    `This task's id is: ${ctx.taskId}`,
    '',
    '## Goal',
    '',
    `Build a pack from diary \`${diaryId}\` that faithfully serves this`,
    `prompt:`,
    '',
    `> ${taskPrompt}`,
    '',
    'What "faithfully" means is your call. A broad prompt may warrant 20',
    'entries spanning clusters; a sharp one may resolve to 4 high-signal',
    'entries. Trust your own judgment on breadth vs. depth — but be able',
    'to defend it in the summary.',
    '',
    '## Constraints',
    '',
    entryTypesPinned
      ? `- Entry types pinned by imposer (do not widen): ${entryTypes!.map((t) => `\`${t}\``).join(', ')}`
      : '- Entry types: **you choose**. The diary contains three kinds:',
    entryTypesPinned
      ? null
      : '  - `episodic` — incident reports, "what happened and how we fixed it" narratives.',
    entryTypesPinned
      ? null
      : '  - `semantic` — durable decisions, patterns, design rationale.',
    entryTypesPinned
      ? null
      : '  - `procedural` — commit audit trails / changelog-style provenance.',
    entryTypesPinned
      ? null
      : '  Pick the subset that fits the prompt. For "failures and workarounds"',
    entryTypesPinned
      ? null
      : '  or "decisions we made" you generally do NOT want `procedural` — those',
    entryTypesPinned
      ? null
      : '  entries are append-only commit logs and produce changelog-shaped packs.',
    entryTypesPinned
      ? null
      : '  Include `procedural` only when the prompt explicitly asks for changelog-',
    entryTypesPinned
      ? null
      : '  style content (e.g., "what shipped this week"). State your choice',
    entryTypesPinned ? null : '  briefly in the final `summary`.',
    `- Recipe tag: \`${resolvedRecipe}\` (recorded on pack params)`,
    tokenBudget
      ? `- Token budget (soft cap on final pack): ${tokenBudget}. Pick entry` +
        ' count so the pack fits — estimate ~300 tok/entry as a starting heuristic,' +
        ' tighten after inspecting actual content lengths.'
      : '- No token budget — size the pack to match the prompt, not an arbitrary target.',
    includeLine,
    excludeLine,
    prefixLine,
    '',
    '## Tools available (not a recipe — use what the situation calls for)',
    '',
    '- `moltnet_diary_tags` — tag inventory with counts. Cheap reconnaissance',
    '  when the prompt implies a scope but not a tag.',
    '- `moltnet_search_entries` — hybrid semantic + lexical search.',
    '- `moltnet_list_entries` — tag-filtered listing.',
    '- `moltnet_get_entry` — full entry read, for disambiguation.',
    '- `moltnet_pack_create` — terminal call that persists the pack.',
    '',
    '## Exploration discipline',
    '',
    'Context is finite. Treat every tool call as buying information against',
    'a budget. Some heuristics that tend to work:',
    '',
    '- **Recon before commitment.** A single broad pass (tag inventory',
    '  or wide search) usually reveals whether the prompt maps to 1 tight',
    '  cluster or several overlapping ones. Decide shape before you read',
    '  individual entries.',
    '- **Compress then narrow.** If the first pass returns 50+ candidates,',
    '  cluster them mentally (by tag / entry_type / date range) and pick',
    '  the 2–3 clusters most relevant. Do NOT read all 50.',
    '- **Read entries only for disambiguation.** If two candidates are',
    '  plausibly the same incident or decision, a quick `moltnet_get_entry`',
    "  resolves it. Don't pre-read everything.",
    '- **Emit a checkpoint if your working set exceeds ~30 candidates.**',
    '  Write one to the `checkpoints` array (see Output) listing the ids',
    "  you're keeping and dropping, plus a note explaining the cut. This",
    '  lets a follow-up session resume without replaying your tool history.',
    '',
    '## Ranking',
    '',
    'Assign integer ranks 1..N, lower = more prominent. Rank reflects',
    'relevance to the prompt, NOT recency or entry popularity. Each entry',
    'in the output must carry a short `rationale` — one sentence pointing',
    'at what in its content earned the rank.',
    '',
    '## Persisting the pack',
    '',
    'Call `moltnet_pack_create` with:',
    '- `entries`: `[{ entryId, rank }]` for each selected entry.',
    '- `params`: `{ recipe: "' +
      resolvedRecipe +
      '", prompt: <the task prompt>, ' +
      'selection_rationale: "<2-sentence summary>" }`.',
    tokenBudget
      ? `- \`tokenBudget\`: ${tokenBudget}.`
      : '- `tokenBudget`: omit.',
    '- `pinned: false` (packs in this pipeline are ephemeral by design).',
    '',
    'The tool returns a JSON payload whose top-level fields are `packId` and',
    '`packCid` (NOT `id`). Copy those exact UUID/CID strings verbatim into',
    '`packId` and `packCid` in your final output — do not substitute an',
    'entry id, do not reformat, do not fabricate a UUID.',
    '',
    '## Hard constraints',
    '',
    '- Do NOT call `moltnet_pack_render` or `moltnet_rendered_pack_judge` —',
    '  those belong to the next sessions.',
    '- Do NOT write diary entries unless curation surfaces a genuine',
    '  incident worth recording. The curation reasoning lives in the task',
    '  output, not in the diary.',
    '- Respect hard include/exclude filters literally.',
    '',
    '## Final output',
    '',
    'Write to stdout a JSON object matching `CuratePackOutput`:',
    '```',
    '{',
    '  "packId": "<uuid>",',
    '  "packCid": "<cid>",',
    '  "entries": [',
    '    { "entryId": "<uuid>", "rank": 1, "rationale": "<why>" }',
    '  ],',
    '  "recipeParams": { "recipe": "...", "prompt": "...", ... },',
    '  "checkpoints": [',
    '    { "phase": "recon", "candidateIds": [...], "droppedIds": [...], "notes": "..." }',
    '  ],',
    '  "summary": "<2-4 sentences: what you looked for, how you narrowed, what defines the final set>"',
    '}',
    '```',
    'The runtime parses this. Failing to emit it is a task failure.',
  ];

  return lines.filter((l): l is string => l !== null).join('\n');
}
