/**
 * Render the "Self-verification" section appended to producer prompts
 * (fulfill_brief, curate_pack, render_pack).
 *
 * The producer LLM is the sole author of `output.verification`. The
 * daemon does not evaluate `input.successCriteria`. Binding evaluation
 * is the role of a separate judgment task — but this self-assessment
 * is non-skippable when the imposer set criteria, regardless of whether
 * a downstream judge ever runs.
 *
 * Per the per-type `validateOutput` cross-field rule:
 *   - `input.successCriteria` set → `output.verification` REQUIRED.
 *   - `input.successCriteria` unset → `output.verification` MUST be omitted.
 *
 * Producers cannot see the judge model from inside their session and
 * should not try to optimize for it. Self-verification is just an
 * honest receipt of "here is how my output measures against the
 * criteria you handed me."
 */
export function buildSelfVerificationBlock(taskId: string): string {
  return [
    '## Self-verification',
    '',
    `Call \`moltnet_get_task\` with task id \`${taskId}\` and read \`input.successCriteria\`.`,
    '',
    '- If `input.successCriteria` is **absent**, omit `verification` from your',
    '  final output entirely.',
    '- If `input.successCriteria` is **present**, you MUST include a',
    '  `verification` block in your final output. Evaluate every applicable',
    '  item — `gates`, `assertions`, `rubric` criteria, `sideEffects` — against',
    '  your produced work and emit one result per id. Be honest: a `fail` with',
    '  a one-line reason is more useful than a false `pass`. Use `skip` (with a',
    '  `detail`) when you genuinely could not determine a result. Compute',
    "  `passed = results.every(r => r.status !== 'fail')`.",
    '',
    'Verification shape:',
    '',
    '```json',
    '{',
    '  "inputCid": "<the inputCid you saw on the task>",',
    '  "results": [',
    '    { "id": "<criterion id>", "kind": "assertion|gate|rubric|sideEffect",',
    '      "status": "pass|fail|skip", "detail": "<optional one-liner>" }',
    '  ],',
    '  "passed": <boolean>',
    '}',
    '```',
    '',
  ].join('\n');
}
