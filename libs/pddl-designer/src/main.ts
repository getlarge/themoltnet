import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';

import { createOllamaDecisionClient } from './decision.js';
import { buildTypesTask, type DesignInput } from './stages.js';
import { runPddlDesign } from './workflow.js';

const USAGE =
  'Usage: pddl-designer --description FILE --problem FILE [--domain-name NAME --problem-name NAME] ' +
  '[--team UUID --diary UUID --profile NAME|ID --correlation UUID --project UUID] [--out FILE] [--max-corrections N] ' +
  '[--review [--decision-model nimble --ollama-url URL --review-threshold 0.9]] [--claim-timeout SEC] [--dry-run]';

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      description: { type: 'string' },
      problem: { type: 'string' },
      'domain-name': { type: 'string', default: 'designed-domain' },
      'problem-name': { type: 'string', default: 'designed-problem' },
      team: { type: 'string' },
      diary: { type: 'string' },
      profile: { type: 'string' },
      project: { type: 'string' },
      correlation: { type: 'string' },
      out: { type: 'string' },
      'max-corrections': { type: 'string', default: '1' },
      review: { type: 'boolean', default: false },
      'claim-timeout': { type: 'string', default: '600' },
      'decision-model': { type: 'string', default: 'nimble' },
      'ollama-url': { type: 'string', default: 'http://localhost:11434' },
      'review-threshold': { type: 'string', default: '0.9' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (!values.description || !values.problem) throw new Error(USAGE);
  const input: DesignInput = {
    description: readFileSync(values.description, 'utf8').trim(),
    problemDescription: readFileSync(values.problem, 'utf8').trim(),
    domainName: values['domain-name'],
    problemName: values['problem-name'],
    teamId: values.team ?? '',
    diaryId: values.diary ?? '',
    correlationId: values.correlation ?? randomUUID(),
    profileId: '',
    ...(values.project ? { projectId: values.project } : {}),
  };
  if (values['dry-run']) {
    process.stdout.write(`${JSON.stringify(buildTypesTask(input), null, 2)}\n`);
    return;
  }
  if (!values.team || !values.diary || !values.profile)
    throw new Error('--team, --diary and --profile are required\n' + USAGE);
  const maxCorrections = Number(values['max-corrections']);
  if (
    !Number.isInteger(maxCorrections) ||
    maxCorrections < 0 ||
    maxCorrections > 3
  )
    throw new Error('--max-corrections must be an integer from 0 to 3');

  const agent = await connect();
  const { items } = await agent.runtimeProfiles.list({ teamId: values.team });
  const profile = items.find(
    (item) => item.id === values.profile || item.name === values.profile,
  );
  if (!profile) throw new Error(`runtime profile ${values.profile} not found`);
  input.profileId = profile.id;

  const threshold = Number(values['review-threshold']);
  if (!(threshold > 0 && threshold < 1))
    throw new Error('--review-threshold must be between 0 and 1');
  const claimTimeoutSec = Number(values['claim-timeout']);
  if (!Number.isInteger(claimTimeoutSec) || claimTimeoutSec < 0)
    throw new Error('--claim-timeout must be a non-negative integer (seconds)');
  const run = await runPddlDesign(createSdkTaskClient(agent), input, {
    maxCorrections,
    claimTimeoutSec,
    ...(values.review
      ? {
          review: {
            threshold,
            decisions: createOllamaDecisionClient({
              model: values['decision-model'],
              baseUrl: values['ollama-url'],
            }),
          },
        }
      : {}),
  });
  const text = `${JSON.stringify(run, null, 2)}\n`;
  if (values.out) writeFileSync(values.out, text);
  else process.stdout.write(text);
  process.stderr.write(
    `[pddl-designer] status=${run.status} stages=${run.stages.length}` +
      (run.plan?.status === 'found'
        ? ` plan=${run.plan.steps.length} steps`
        : '') +
      (run.reviewPassed === undefined
        ? ''
        : ` review=${run.reviewPassed ? 'passed' : 'findings'} rounds=${run.review?.length ?? 0}`) +
      (run.failure
        ? ` failure=${run.failure.stage}: ${run.failure.reason}`
        : '') +
      '\n',
  );
  if (run.status === 'failed' || run.status === 'invalid') process.exitCode = 1;
}
