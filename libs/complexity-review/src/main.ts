import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { type Rubric, Rubric as RubricSchema } from '@moltnet/tasks';
import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';
import { Value } from 'typebox/value';

import { buildEvidence, type Git } from './evidence.js';
import { buildChangeMapTask, runComplexityReview } from './workflow.js';

function git(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function ghPr(repo: string, pr: number) {
  return JSON.parse(
    execFileSync(
      'gh',
      [
        'pr',
        'view',
        String(pr),
        '--repo',
        repo,
        '--json',
        'title,body,headRefOid,baseRefOid,commits',
      ],
      { encoding: 'utf8' },
    ),
  ) as {
    title: string;
    body: string | null;
    headRefOid: string;
    baseRefOid: string;
    commits: Array<{ messageHeadline: string; messageBody: string | null }>;
  };
}

export async function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      pr: { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
      team: { type: 'string' },
      diary: { type: 'string' },
      profile: { type: 'string' },
      correlation: { type: 'string' },
      rubric: {
        type: 'string',
        default: 'rubrics/pr-complexity-binary-v1.json',
      },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const pr = Number(values.pr);
  if (
    !values.repo ||
    !Number.isInteger(pr) ||
    pr < 1 ||
    !values.base ||
    !values.head
  ) {
    throw new Error(
      'Usage: complexity-review --repo owner/repo --pr N --base OID --head OID [--team UUID --diary UUID --profile name --correlation UUID] [--dry-run]',
    );
  }
  const meta = ghPr(values.repo, pr);
  if (meta.baseRefOid !== values.base || meta.headRefOid !== values.head) {
    throw new Error(
      'PR revisions changed after preparation; refusing to review a moving target',
    );
  }
  const parsed = JSON.parse(readFileSync(values.rubric, 'utf8')) as unknown;
  if (!Value.Check(RubricSchema, parsed))
    throw new Error('invalid complexity rubric');
  const rubric: Rubric = parsed;
  git(['fetch', '--no-tags', 'origin', values.base, values.head]);
  const evidence = buildEvidence(git as Git, values.base, values.head);
  const context = {
    repo: values.repo,
    pr,
    title: meta.title,
    body: meta.body ?? '',
    commits: meta.commits.map(
      ({ messageHeadline, messageBody }) =>
        `${messageHeadline}\n${messageBody ?? ''}`,
    ),
    base: values.base,
    head: values.head,
    teamId: values.team ?? '',
    diaryId: values.diary ?? '',
    correlationId: values.correlation ?? randomUUID(),
    profileId: '',
    rubric,
  };
  if (values['dry-run']) {
    process.stdout.write(
      `${JSON.stringify({ bytes: evidence.bytes, files: evidence.files.length, task: buildChangeMapTask(context, evidence) }, null, 2)}\n`,
    );
    return;
  }
  if (!values.team || !values.diary || !values.profile)
    throw new Error('--team, --diary and --profile are required');
  const agent = await connect();
  const { items } = await agent.runtimeProfiles.list({ teamId: values.team });
  const profile = items.find(
    (item) => item.id === values.profile || item.name === values.profile,
  );
  if (!profile) throw new Error(`runtime profile ${values.profile} not found`);
  context.profileId = profile.id;
  const result = await runComplexityReview(
    createSdkTaskClient(agent),
    context,
    evidence,
  );
  process.stdout.write(
    `${JSON.stringify({ ...result, base: values.base, head: values.head, pr }, null, 2)}\n`,
  );
}
