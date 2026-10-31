import { runComplexityReview } from '@moltnet/complexity-review/workflow';
import type { Git } from '@moltnet/docs-impact-review';
import { Rubric } from '@moltnet/tasks';
import { Value } from 'typebox/value';

import type { LaneContext, LaneResult } from './lane.js';
import { DEFAULT_COMPLEXITY_RUBRIC } from './review-assets.js';

const MAX_COMMITS = 100;

/** PR commit messages, oldest first, read from the fetched inert history. */
function commitMessages(git: Git, base: string, head: string): string[] {
  return git([
    'log',
    '--reverse',
    `--max-count=${MAX_COMMITS}`,
    '--format=%B%x00',
    `${base}..${head}`,
  ])
    .split('\0')
    .map((message) => message.trim())
    .filter(Boolean);
}

/** Runs the complexity review and maps its rubric scores to a lane result. */
export async function runComplexityLane(ctx: LaneContext): Promise<LaneResult> {
  const { git, identity } = ctx;
  const rubricValue: unknown = ctx.policy.complexity
    ? JSON.parse(
        git(['show', `${identity.base}:${ctx.policy.complexity.rubric}`]),
      )
    : DEFAULT_COMPLEXITY_RUBRIC;
  if (!Value.Check(Rubric, rubricValue))
    throw new Error('invalid complexity rubric');
  const result = await runComplexityReview(
    ctx.tasks,
    {
      repo: identity.repo,
      pr: identity.pr,
      title: identity.title,
      body: identity.body,
      commits: commitMessages(git, identity.base, identity.head),
      base: identity.base,
      head: identity.head,
      teamId: identity.teamId,
      diaryId: identity.diaryId,
      correlationId: identity.correlationId,
      profileId: ctx.profileId,
      rubric: rubricValue,
      taskBudget: ctx.budget,
      tags: ['review:adaptive', 'lane:complexity'],
    },
    ctx.evidence,
    { serialDomainDispatch: true },
  );
  const failed = result.output.scores.filter(
    (score) => score.status === 'fail',
  );
  const unclear = result.output.scores.filter(
    (score) => score.status === 'unclear',
  );
  const unreviewed = result.unreviewedDomainWork;
  const coverage = unreviewed
    ? `Incomplete coverage: ${unreviewed} domain segment${unreviewed === 1 ? '' : 's'} ${unreviewed === 1 ? 'was' : 'were'} not reviewed.`
    : '';
  let status: LaneResult['status'] = 'clear';
  if (failed.length) status = 'concern';
  else if (unreviewed > 0 || unclear.length) status = 'unclear';
  // An unclear summary is listed as an assessment gap, so it names the
  // gap rather than repeating the verdict.
  let summary = result.output.verdict;
  if (status === 'unclear')
    summary =
      coverage ||
      `${unclear.length} rubric criteri${unclear.length === 1 ? 'on' : 'a'} could not be assessed.`;
  else {
    summary = [
      summary,
      ...failed.map((score) => `${score.criterionId}: ${score.rationale}`),
      coverage,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return {
    lane: 'complexity',
    status,
    summary,
    taskIds: result.taskIds,
    // Rubric failures assess review difficulty, not located code defects.
    // Preserve their rationale in the assessment without fabricating findings.
    findings: [],
    ...(status === 'unclear'
      ? {
          unclear: unclear.map(
            (score) => `${score.criterionId}: ${score.rationale}`,
          ),
        }
      : {}),
  };
}
