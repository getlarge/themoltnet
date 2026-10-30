import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { changedLines } from '../../libs/security-review/src/review.js';
import { validateOutputContractResult } from '../../libs/tasks/src/output-contract-validation.js';

const root = resolve(process.argv[2] ?? '/tmp/review-guidance-eval');
const read = (name: string) =>
  JSON.parse(readFileSync(`${root}/${name}`, 'utf8'));
const rows = read('runs.json');
const policy = read('allowed-tools.json');
if (
  policy.enforcement !== 'enforce' ||
  policy.allowedTools.length ||
  policy.allowedShellCommands.length
)
  throw new Error('Evaluation requires an enforced empty allow-set');
const scored: object[] = [];
const judge: object[] = [];
for (const row of rows) {
  const tag = `${row.case}-${row.arm}-${row.repeat}`;
  const task = read(`${tag}-task.json`);
  const attempts = read(`${tag}-attempts.json`);
  const attempt = attempts.find(
    (a: { attemptN: number }) => a.attemptN === task.acceptedAttemptN,
  );
  const conversation = read(`${tag}-conversation.json`);
  const errors: string[] = [];
  if (task.status !== 'completed' || !attempt?.output)
    errors.push('execution-or-missing-output');
  const output = attempt?.output;
  const schemaErrors = validateOutputContractResult(
    'freeform',
    task.input,
    output,
  );
  if (schemaErrors.length) errors.push('output-contract');
  const lines = changedLines(task.input.brief);
  if (!schemaErrors.length) {
    for (const finding of output.result.findings) {
      if (
        !lines
          .get(finding.path)
          ?.[finding.side as 'old' | 'new'].has(finding.line)
      )
        errors.push(`citation:${finding.path}:${finding.side}:${finding.line}`);
    }
  }
  const calls = conversation.messages.flatMap(
    (entry: { message: { content: unknown } }) =>
      Array.isArray(entry.message.content)
        ? entry.message.content.filter(
            (block: { type: string }) => block.type === 'toolCall',
          )
        : [],
  );
  if (
    calls.some(
      (call: { name: string }) => call.name !== 'submit_freeform_output',
    )
  )
    errors.push('forbidden-tool-call');
  if (
    calls.filter(
      (call: { name: string }) => call.name === 'submit_freeform_output',
    ).length !== 1
  )
    errors.push('submit-count');
  if (conversation.nextBeforeEntryId) errors.push('conversation-incomplete');
  if (task.input.execution?.workspace !== 'none')
    errors.push('workspace-isolation');
  if (attempt?.policySnapshotHash !== policy.policySnapshotHash)
    errors.push('policy-mismatch');
  const id = createHash('sha256').update(tag).digest('hex').slice(0, 12);
  scored.push({
    ...row,
    id,
    gatesPassed: errors.length === 0,
    errors,
    toolCalls: calls.map((c: { name: string }) => c.name),
    usage: attempt?.usage,
  });
  if (!errors.length)
    judge.push({ id, scenario: row.case, result: output.result });
}
writeFileSync(
  `${root}/gate-results.json`,
  JSON.stringify(scored, null, 2) + '\n',
);
// Arm, repeat, task identity and execution metadata are omitted from judge input.
judge.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
writeFileSync(
  `${root}/blinded-judge-input.json`,
  JSON.stringify(judge, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    runs: scored.length,
    gatesPassed: judge.length,
    gatedOut: scored.length - judge.length,
  }),
);
