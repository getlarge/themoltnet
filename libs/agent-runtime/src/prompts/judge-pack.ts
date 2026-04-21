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
    : '';

  const lines = [
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
    '- `deterministic_signature_check`: for every source entry referenced',
    '  by the rendered pack, call `moltnet_get_entry` and then confirm it',
    '  is content-signed (has `content_signature` set). Score 1 iff every',
    '  referenced signed-eligible entry has a valid signature; otherwise 0.',
    '  Populate `evidence` with `{ entries_verified, entries_total, signature_failures: [entry_ids] }`.',
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
    '  "renderer_binary_cid": "<cid-if-available>"',
    '}',
    '```',
    'Write a signed diary entry (tags: `judgment`, `judge_pack`, ' +
      `\`rubric:${rubric.rubric_id}\`) capturing the rationale before`,
    'emitting the JSON.',
  ];

  return lines.filter(Boolean).join('\n');
}
