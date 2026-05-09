import type { AssessBriefInput } from '@moltnet/tasks';

import { buildFinalOutputBlock } from './final-output.js';

interface Ctx {
  diaryId: string;
  taskId: string;
}

/**
 * Build the first user-message prompt for an `assess_brief` judge attempt.
 *
 * Design note — no pre-resolved `target` projection
 * --------------------------------------------------
 * Earlier drafts hand-wired a `target` bundle (branch, PR url,
 * commits, summary, diary entry ids) into the prompt before the
 * judge started. That coupled the daemon to one specific producer
 * shape (`FulfillBriefOutput`), forced every executor to know how
 * to project it, and went stale every time a producer task type
 * grew a field. Trade-off was wrong: the runtime is meant to be
 * task-type-agnostic, and judges are perfectly capable of
 * fetching their own data.
 *
 * Now: the prompt tells the judge the `targetTaskId` and instructs
 * it to call `moltnet_get_task` + `moltnet_list_task_attempts`
 * itself. The judge sees whatever the producer's accepted attempt
 * actually wrote — no projection, no lossiness, no daemon-side
 * type knowledge required. Different producers (fulfill_brief,
 * future task types whose products are docs / configs / changes /
 * anything) work without any code path here.
 */
export function buildAssessBriefUserPrompt(
  input: AssessBriefInput,
  ctx: Ctx,
): string {
  // Per-type validateInput already ensured rubric is present for
  // judgment tasks — narrow safely.
  const rubric = input.successCriteria.rubric!;

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
    '# Assess Brief Judge',
    '',
    'You are an independent judge. You did NOT produce the work under review.',
    'Score each criterion as specified below and emit a structured judgment.',
    'You may read code, commits, and diary entries — but do NOT modify anything.',
    '',
    `Your diary ID is: ${ctx.diaryId}`,
    `This task's id is: ${ctx.taskId}`,
    '',
    '## Target of assessment',
    '',
    `**Producer task id:** \`${input.targetTaskId}\``,
    '',
    'Investigate the producer task before scoring:',
    '',
    `1. Call \`moltnet_get_task\` with taskId=\`${input.targetTaskId}\`. ` +
      'Note its `taskType`, `acceptedAttemptN`, and `references[]`.',
    `2. Call \`moltnet_list_task_attempts\` with taskId=\`${input.targetTaskId}\`. ` +
      'Find the attempt whose `attemptN` matches `acceptedAttemptN`. Its ' +
      '`output` is the canonical artefact you are judging — earlier ' +
      'failed/timed_out attempts are audit-only and must NOT influence the score.',
    "3. Read the accepted attempt's `output`. Common shapes you may encounter:",
    '   - `pullRequestUrl` set → run `gh pr diff <number>` and `gh pr view <number>` to read the change.',
    '   - `branch` set without a PR → run `git log <branch>` and `git diff main..<branch>`.',
    '   - `commits[].sha` listed → use `git show <sha>` for individual commits.',
    "   - `diaryEntryIds[]` listed → fetch each via `moltnet_get_entry` to read the producer's reasoning.",
    '   - `summary` set → use as orientation, not as ground truth.',
    "Adapt your investigation to whatever the output actually contains. Score conservatively when the producer's output is opaque or thin.",
    '',
    "### Querying the producer's diary entries",
    '',
    `Beyond the explicit \`diaryEntryIds[]\` from step 3, the producer's`,
    'attempts auto-tag every entry with the `task:*` provenance namespace.',
    'You can pull the full set without enumerating ids by passing the',
    '`taskFilter` shorthand to `moltnet_list_entries` or',
    '`moltnet_search_entries`:',
    '',
    `- All entries from the producer task: \`taskFilter: { taskId: "${input.targetTaskId}" }\`.`,
    '- Just the accepted attempt: add `attemptN: <acceptedAttemptN>`.',
    '- The producer plus any prior chain (when a correlationId was set):',
    '  read it from the task you fetched in step 1 and pass',
    '  `taskFilter: { correlationId: "<id>" }`.',
    '',
    preambleSection,
    '## Criteria',
    '',
    criteriaList,
    '',
    '### Scoring rules',
    '',
    '- `llm_score`: score 0..1 continuous. `rationale` REQUIRED (2–4 sentences).',
    '- `boolean`: score exactly 0 or 1. `rationale` optional.',
    '- `deterministic_signature_check`: run `moltnet entry verify` on every diary entry returned by step 3 above AND `git verify-commit` on every commit. Score 1 iff ALL signatures are valid; otherwise 0. Populate `evidence.commitsVerified`, `evidence.commitsTotal`, `evidence.signatureFailures`.',
    '',
    'Write a signed diary entry (tags: "judgment", "assess_brief") capturing the rationale before reporting structured output.',
    '',
    buildFinalOutputBlock({
      taskType: 'assess_brief',
      outputSchemaName: 'AssessBriefOutput',
      shapeSketch: [
        '{',
        '  "scores": [',
        '    { "criterionId": "...", "score": 0.0, "rationale": "...", "evidence": {} }',
        '  ],',
        '  "composite": <sum>,',
        '  "verdict": "<1-3 sentence overall>",',
        '  "judgeModel": "<provider:model>"',
        '}',
      ].join('\n'),
      extraNotes: [
        '`composite` = Σ(weight_i × score_i) recomputed. The runtime rejects a mismatch.',
      ],
    }),
  ];

  return lines.filter(Boolean).join('\n');
}
