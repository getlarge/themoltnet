import type { JudgePackInput } from '@moltnet/tasks';

interface Ctx {
  diaryId: string;
  taskId: string;
}

export function buildJudgePackPrompt(input: JudgePackInput, ctx: Ctx): string {
  const {
    rendered_pack_id: renderedPackId,
    source_pack_id: sourcePackId,
    rubric,
  } = input;

  const criteriaList = rubric.criteria
    .map(
      (c, i) =>
        `${i + 1}. **${c.id}** (weight ${c.weight}, scoring: \`${c.scoring}\`) — ${c.description}`,
    )
    .join('\n');

  const preambleSection = rubric.preamble
    ? ['### Rubric preamble', '', rubric.preamble, ''].join('\n')
    : null;

  const lines: Array<string | null> = [
    '# Judge Pack Agent',
    '',
    'You are an independent judge. You did NOT curate or render the pack',
    'under review. Score each rubric criterion and emit a structured',
    'judgment. You may read the source pack, the rendered pack, and any',
    'referenced entries — but do NOT modify anything.',
    '',
    `Your diary ID is: ${ctx.diaryId}`,
    `This task's id is: ${ctx.taskId}`,
    '',
    '## Target',
    '',
    `- **Rendered pack**: \`${renderedPackId}\``,
    `- **Source pack**: \`${sourcePackId}\``,
    `- **Rubric**: \`${rubric.rubric_id}\` v${rubric.version}`,
    '',
    preambleSection,
    '## Workflow',
    '',
    '1. Call `moltnet_rendered_pack_get` for the rendered pack. Keep the',
    '   `content` string — you will score it.',
    '2. Call `moltnet_pack_get` with `expand: "entries"` for the source',
    '   pack. Keep the source entries for grounding / coverage checks.',
    '3. For each criterion, score according to its `scoring` mode (see',
    '   Scoring rules below). Produce rationales where required.',
    '4. Compute `composite = Σ(weight_i × score_i)` and sanity-check it',
    '   equals the sum you will emit — the runtime rejects mismatches.',
    '',
    '## Criteria',
    '',
    criteriaList,
    '',
    '### Scoring rules',
    '',
    '- `llm_judged`: score 0..1 continuous. `rationale` REQUIRED (2–4',
    '  sentences pointing at specific evidence in the rendered content or',
    '  the source entries).',
    '- `boolean`: score exactly 0 or 1. `rationale` optional.',
    '- `deterministic_signature_check`: batch-fetch ALL referenced source',
    '  entries in a single call — `moltnet_list_entries` with `entryIds` set',
    '  to the array of source entry IDs (max 50). Do NOT call',
    '  `moltnet_get_entry` per entry. For each returned entry, classify as',
    '  REQUIRED-SIGNED or OPTIONAL using this rule:',
    '    • REQUIRED-SIGNED iff `entryType` is `identity` or `soul`, OR',
    '      `entryType` is `procedural` AND `tags` contains `risk:high`.',
    '    • All others (`episodic`, `reflection`, unsigned `semantic`,',
    '      `procedural` with `risk:low`/`risk:medium`/no risk tag) are',
    '      OPTIONAL — DO NOT penalize when unsigned.',
    '  Score = required_signed_ok / required_signed_total, where',
    '  required_signed_ok counts REQUIRED-SIGNED entries that have a',
    '  non-empty `contentSignature`. If `required_signed_total` is 0,',
    '  score = 1. Populate `evidence` with `{ entries_verified,',
    '  entries_total, required_signed_total, required_signed_ok,',
    '  signature_failures: [entry_ids] }` where `signature_failures` lists',
    '  ONLY the REQUIRED-SIGNED entries that lack a signature.',
    '- `deterministic_coverage_check`: for every source entry, check',
    '  whether its `entry_id` (or a stable reference like title + CID',
    '  prefix) appears in the rendered `content`. Score 1 iff coverage is',
    '  complete; otherwise 0. Populate `evidence` with `{ covered, total, missing: [entry_ids] }`.',
    '',
    '## Constraints',
    '',
    '- Do NOT call `moltnet_pack_create` or `moltnet_pack_render`.',
    "- Do NOT fetch the curator's or renderer's task output directly — they",
    '  may leak guidance that biases judgment.',
    '- Keep the session focused on scoring; no speculative exploration.',
    '',
    '## Final output',
    '',
    'Write to stdout a JSON object matching `JudgePackOutput`:',
    '```',
    '{',
    '  "scores": [{"criterion_id": "...", "score": 0.0, "rationale": "...", "evidence": {...}}],',
    '  "composite": <sum-of-weighted-scores>,',
    '  "verdict": "<1-3 sentence overall>",',
    '  "judge_model": "<provider:model>",',
    '  "renderer_binary_cid": "<cid-string-only-if-available>"',
    '}',
    '```',
    'Omit `renderer_binary_cid` entirely when no binary CID is exposed by',
    '`moltnet_rendered_pack_get`. Do NOT emit `null` — the field is optional',
    'and absence is the correct representation when unavailable.',
    'Write a signed diary entry (tags: `judgment`, `judge_pack`, ' +
      `\`rubric:${rubric.rubric_id}\`) capturing the rationale before`,
    'emitting the JSON.',
  ];

  return lines.filter((l): l is string => l !== null).join('\n');
}
