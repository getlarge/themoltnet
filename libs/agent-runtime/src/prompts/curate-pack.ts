import type { CuratePackInput } from '@moltnet/tasks';

import {
  type AssembledPrompt,
  assembleTaskPrompt,
  type PromptSection,
} from './assemble.js';
import { buildFinalOutputBlock } from './final-output.js';
import { buildSelfVerificationBlock } from './self-verification.js';

interface Ctx {
  diaryId: string;
  taskId: string;
}

/**
 * Build the first user-message prompt for a `curate_pack` task.
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
 * tool subset and a turn cap, and returns compressed summaries.
 */
export function buildCuratePackUserPrompt(
  input: CuratePackInput,
  ctx: Ctx,
): AssembledPrompt {
  const { diaryId, taskPrompt, entryTypes, tagFilters, tokenBudget, recipe } =
    input;

  const entryTypesPinned = Boolean(entryTypes);
  const resolvedRecipe = recipe ?? 'topic-focused-v1';

  const header = [
    '# Curate Pack Agent',
    '',
    'You are the curator. Step 1 of the three-session attribution loop:',
    'you pick and rank diary entries, another agent will render, a third',
    'will judge. Your output IS the pack — nobody downstream will re-rank.',
    '',
    `Your agent-session diary ID is: ${ctx.diaryId}`,
    `This task's id is: ${ctx.taskId}`,
  ].join('\n');

  const goal = [
    `Build a pack from diary \`${diaryId}\` that faithfully serves this`,
    'prompt:',
    '',
    `> ${taskPrompt}`,
    '',
    'What "faithfully" means is your call. A broad prompt may warrant 20',
    'entries spanning clusters; a sharp one may resolve to 4 high-signal',
    'entries. Trust your own judgment on breadth vs. depth — but be able',
    'to defend it in the summary.',
  ].join('\n');

  const constraintsLines: string[] = [];
  if (entryTypesPinned) {
    constraintsLines.push(
      `- Entry types pinned by imposer (do not widen): ${entryTypes!.map((t) => `\`${t}\``).join(', ')}`,
    );
  } else {
    constraintsLines.push(
      '- Entry types: **you choose**. The diary contains three kinds:',
      '  - `episodic` — incident reports, "what happened and how we fixed it" narratives.',
      '  - `semantic` — durable decisions, patterns, design rationale.',
      '  - `procedural` — commit audit trails / changelog-style provenance.',
      '  Pick the subset that fits the prompt. For "failures and workarounds"',
      '  or "decisions we made" you generally do NOT want `procedural` — those',
      '  entries are append-only commit logs and produce changelog-shaped packs.',
      '  Include `procedural` only when the prompt explicitly asks for changelog-',
      '  style content (e.g., "what shipped this week"). State your choice',
      '  briefly in the final `summary`.',
    );
  }
  constraintsLines.push(
    `- Recipe tag: \`${resolvedRecipe}\` (recorded on pack params)`,
  );
  constraintsLines.push(
    tokenBudget
      ? `- Token budget (soft cap on final pack): ${tokenBudget}. Pick entry count so the pack fits — estimate ~300 tok/entry as a starting heuristic, tighten after inspecting actual content lengths.`
      : '- No token budget — size the pack to match the prompt, not an arbitrary target.',
  );
  if (tagFilters?.include?.length) {
    constraintsLines.push(
      `- Hard include (ALL must be present on an entry): ${tagFilters.include.map((t) => `\`${t}\``).join(', ')}`,
    );
  }
  if (tagFilters?.exclude?.length) {
    constraintsLines.push(
      `- Hard exclude (drop if ANY present): ${tagFilters.exclude.map((t) => `\`${t}\``).join(', ')}`,
    );
  }
  if (tagFilters?.prefix) {
    constraintsLines.push(
      `- Tag prefix hint when inventorying: \`${tagFilters.prefix}\``,
    );
  }
  const constraints = constraintsLines.join('\n');

  const tools = [
    '- `moltnet_diary_tags` — tag inventory with counts. Cheap reconnaissance',
    '  when the prompt implies a scope but not a tag. Pass',
    '  `prefix: "task:"` to enumerate task-provenance tags only',
    '  (`task:type:*`, `task:correlation:*`, etc.).',
    '- `moltnet_search_entries` — hybrid semantic + lexical search.',
    '  Filters AND with the query: pass `tags`, `excludeTags`,',
    '  `entryTypes`, or the `taskFilter` shorthand to narrow before',
    '  ranking. Example: `taskFilter: { taskType: "fulfill_brief" }`',
    '  returns only entries from fulfill_brief attempts.',
    '- `moltnet_list_entries` — multi-tag (AND) listing with optional',
    '  `excludeTags`, `entryType`, and the same `taskFilter` shorthand.',
    '- `moltnet_get_entry` — full entry read, for disambiguation.',
    '- `moltnet_pack_create` — terminal call that persists the pack.',
  ].join('\n');

  const exploration = [
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
  ].join('\n');

  const ranking = [
    'Assign integer ranks 1..N, lower = more prominent. Rank reflects',
    'relevance to the prompt, NOT recency or entry popularity. Each entry',
    'in the output must carry a short `rationale` — one sentence pointing',
    'at what in its content earned the rank.',
  ].join('\n');

  const persisting = [
    'Call `moltnet_pack_create` with:',
    '- `entries`: `[{ entryId, rank }]` for each selected entry.',
    `- \`params\`: \`{ recipe: "${resolvedRecipe}", prompt: <the task prompt>, selection_rationale: "<2-sentence summary>" }\`.`,
    tokenBudget
      ? `- \`tokenBudget\`: ${tokenBudget}.`
      : '- `tokenBudget`: omit.',
    '- `pinned: false` (packs in this pipeline are ephemeral by design).',
    '',
    'The tool returns a JSON payload whose top-level fields are `packId` and',
    '`packCid` (NOT `id`). Copy those exact UUID/CID strings verbatim into',
    '`packId` and `packCid` in your final output — do not substitute an',
    'entry id, do not reformat, do not fabricate a UUID.',
  ].join('\n');

  const hardConstraints = [
    '- Do NOT call `moltnet_pack_render` — that belongs to the next session.',
    '- Do NOT write diary entries unless curation surfaces a genuine',
    '  incident worth recording. The curation reasoning lives in the task',
    '  output, not in the diary.',
    '- Respect hard include/exclude filters literally.',
  ].join('\n');

  const sections: PromptSection[] = [
    { id: 'curate_pack.header', source: 'header', body: header },
    {
      id: 'curate_pack.goal',
      source: 'task_input',
      header: 'Goal',
      body: goal,
    },
    {
      id: 'curate_pack.constraints',
      source: 'task_input',
      header: 'Constraints',
      body: constraints,
    },
    {
      id: 'curate_pack.tools',
      source: 'static',
      header:
        'Tools available (not a recipe — use what the situation calls for)',
      body: tools,
    },
    {
      id: 'curate_pack.exploration',
      source: 'static',
      header: 'Exploration discipline',
      body: exploration,
    },
    {
      id: 'curate_pack.ranking',
      source: 'static',
      header: 'Ranking',
      body: ranking,
    },
    {
      id: 'curate_pack.persisting',
      source: 'static',
      header: 'Persisting the pack',
      body: persisting,
    },
    {
      id: 'curate_pack.hard_constraints',
      source: 'static',
      header: 'Hard constraints',
      body: hardConstraints,
    },
    {
      id: 'curate_pack.verification',
      source: 'verification',
      body: buildSelfVerificationBlock(ctx.taskId),
    },
    {
      id: 'curate_pack.final_output',
      source: 'final_output',
      body: buildFinalOutputBlock({
        taskType: 'curate_pack',
        outputSchemaName: 'CuratePackOutput',
        shapeSketch: [
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
          '  "summary": "<2-4 sentences: what you looked for, how you narrowed, what defines the final set>",',
          '  "verification": <required iff input.successCriteria; see Self-verification>',
          '}',
        ].join('\n'),
      }),
    },
  ];

  return assembleTaskPrompt('curate_pack', sections);
}
