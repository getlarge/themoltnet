import type { JudgePackInput } from '@moltnet/tasks';

import { buildFinalOutputBlock } from './final-output.js';
import {
  renderRubricCriteriaList,
  renderRubricPreambleSection,
} from './rubric-common.js';

interface Ctx {
  diaryId: string;
  taskId: string;
}

export function buildJudgePackUserPrompt(
  input: JudgePackInput,
  ctx: Ctx,
): string {
  const { renderedPackId, sourcePackId, successCriteria } = input;
  // Per-type validateInput already ensured rubric is present for
  // judgment tasks — narrow safely.
  const rubric = successCriteria.rubric!;

  const criteriaList = renderRubricCriteriaList(rubric);
  const preambleSection = renderRubricPreambleSection(rubric);

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
    `- **Rubric**: \`${rubric.rubricId}\` v${rubric.version}`,
    '',
    preambleSection,
    '## Workflow',
    '',
    '1. Call `moltnet_rendered_pack_get` for the rendered pack. Keep the',
    '   `content` string — you will score it.',
    '2. Call `moltnet_pack_get` with `expandEntries: true` for the source',
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
    '- `llm_score`: score 0..1 continuous. `rationale` REQUIRED (2–4',
    '  sentences pointing at specific evidence in the rendered content or',
    '  the source entries). NOTE: this mode smooths individual failures',
    '  into the gradient. Prefer `llm_checklist` for grounding,',
    '  faithfulness, or any property where one failure is a real failure.',
    '- `llm_checklist`: enumerate per-claim binary assertions instead of',
    '  picking a continuous score. For each assertion, return',
    '  `{ id, text, passed: bool, evidence: string }`. `evidence` is',
    '  REQUIRED for both PASS and FAIL — for PASS, quote the supporting',
    '  span (rendered or source) or cite the source entry id; for FAIL,',
    '  quote the offending claim verbatim and explain why it fails.',
    "  Don't give the benefit of the doubt: if a claim looks supported but",
    '  you cannot point at the supporting source span, mark it FAIL with',
    '  evidence = "no supporting span found". Set the criterion `score`',
    '  to `1` iff every assertion passes, else `0` — the runtime checks',
    '  this matches the assertions array. Populate `assertions` on the',
    '  score object; leave `evidence` (the structured record) empty.',
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
    '  signatureFailures: [entryIds] }` where `signatureFailures` lists',
    '  ONLY the REQUIRED-SIGNED entries that lack a signature.',
    '- `deterministic_coverage_check`: for every source entry, check',
    '  whether its `entryId` (or a stable reference like title + CID',
    '  prefix) appears in the rendered `content`. Score 1 iff coverage is',
    '  complete; otherwise 0. Populate `evidence` with `{ covered, total, missing: [entryIds] }`.',
    '',
    '## Constraints',
    '',
    '- Do NOT call `moltnet_pack_create` or `moltnet_pack_render`.',
    "- Do NOT fetch the curator's or renderer's task output directly — they",
    '  may leak guidance that biases judgment.',
    '- Keep the session focused on scoring; no speculative exploration.',
    '',
    'Write a signed diary entry (tags: `judgment`, `judge_pack`, ' +
      `\`rubric:${rubric.rubricId}\`) capturing the rationale before`,
    'reporting structured output.',
    '',
    buildFinalOutputBlock({
      taskType: 'judge_pack',
      outputSchemaName: 'JudgePackOutput',
      shapeSketch: [
        '{',
        '  "scores": [',
        '    { "criterionId": "...", "score": 0.0, "rationale": "...", "evidence": {} },',
        '    {',
        '      "criterionId": "<llm_checklist criterion>",',
        '      "score": 0,                          // 1 iff every assertion passed',
        '      "assertions": [',
        '        { "id": "claim-1", "text": "...", "passed": false, "evidence": "..." }',
        '      ]',
        '    }',
        '  ],',
        '  "composite": <sum-of-weighted-scores>,',
        '  "verdict": "<1-3 sentence overall>",',
        '  "judgeModel": "<provider:model>",',
        '  "rendererBinaryCid": "<cid-string-only-if-available>"',
        '}',
      ].join('\n'),
      extraNotes: [
        'Omit `rendererBinaryCid` entirely when no binary CID is exposed by',
        '`moltnet_rendered_pack_get`. Do NOT emit `null` — the field is',
        'optional and absence is the correct representation when unavailable.',
      ],
    }),
  ];

  return lines.filter((l): l is string => l !== null).join('\n');
}
