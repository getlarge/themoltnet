// Self-verification prompt block for producer task types — see
// docs/agent-runtime.md for the producer/judge model.
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
