import {
  createSleepingContext,
  type DocsImpactReport,
  loadReviewConfig,
  runDocsImpactReview,
} from '@moltnet/docs-impact-review';
import type { TaskClient } from '@themoltnet/tasks-orchestrator';

import { type LaneContext, type LaneResult, logLaneFailure } from './lane.js';

const DOCS_STAGE_TAG = /^stage:(extract|coverage|docs-check)$/;

function docsResult(
  report: DocsImpactReport,
  createdTaskIds: string[],
  stages: Map<string, string>,
): LaneResult {
  let status: LaneResult['status'] = 'clear';
  if (report.status === 'failed') status = 'failed';
  else if (report.outcome === 'updates-needed') status = 'concern';
  else if (report.outcome === 'incomplete') status = 'unclear';
  const taskIds = [
    ...new Set([
      ...createdTaskIds,
      ...Object.values(report.timings.stages).flatMap((stage) =>
        stage ? [stage.taskId] : [],
      ),
    ]),
  ];
  const stageFromError = /^(extract|coverage|docs-check) stage:/.exec(
    report.error ?? '',
  )?.[1];
  const stage =
    stageFromError ??
    (taskIds.length === 1 ? stages.get(taskIds[0]) : undefined) ??
    (taskIds.length ? 'task-outcome' : 'before-task');
  const error = report.error ?? '';
  const code = /worker stopped/i.test(error)
    ? 'worker-unavailable'
    : /poll|read task|task lookup/i.test(error)
      ? 'polling-error'
      : /timeout|timed out|deadline/i.test(error)
        ? 'timeout'
        : /invalid|schema|output/i.test(error)
          ? 'invalid-output'
          : /fetch|git /i.test(error)
            ? 'git-error'
            : /config|policy/i.test(error)
              ? 'config-error'
              : 'unexpected-error';
  if (report.status === 'failed') logLaneFailure('docs', taskIds, code, stage);
  return {
    lane: 'docs',
    status,
    summary:
      report.status === 'failed'
        ? `Docs review failed during ${stage} (${code}); inspect ${taskIds.length ? 'its task outcome' : 'workflow logs'}.`
        : `Docs impact: ${report.outcome}.`,
    taskIds,
    findings: report.findings.map((finding) => ({
      path: finding.docsPath,
      concern: finding.update,
    })),
    ...(status === 'unclear'
      ? { unclear: report.gaps.map((gap) => `${gap.scope}: ${gap.reason}`) }
      : {}),
  };
}

/** Runs the docs impact review for the pinned revision. */
export async function runDocsLane(ctx: LaneContext): Promise<LaneResult> {
  const { git, identity } = ctx;
  const taskIds: string[] = [];
  const stages = new Map<string, string>();
  const listMessages = ctx.tasks.listMessages?.bind(ctx.tasks);
  const tasks: TaskClient = {
    async createTask(body, options) {
      const task = await ctx.tasks.createTask(body, options);
      taskIds.push(task.id);
      const stage = body.tags
        ?.map((tag) => DOCS_STAGE_TAG.exec(tag)?.[1])
        .find(Boolean);
      if (stage) stages.set(task.id, stage);
      return task;
    },
    getTask: (id) => ctx.tasks.getTask(id),
    listAttempts: (id) => ctx.tasks.listAttempts(id),
    ...(listMessages ? { listMessages } : {}),
  };
  const { config, source } = loadReviewConfig(
    git,
    identity.base,
    ctx.policy.docs?.config,
  );
  const report = await runDocsImpactReview(
    { git, tasks, ctx: createSleepingContext() },
    {
      repo: identity.repo,
      pr: identity.pr,
      prTitle: identity.title,
      baseRevision: identity.base,
      headRevision: identity.head,
      teamId: identity.teamId,
      diaryId: identity.diaryId,
      correlationId: identity.correlationId,
      profileId: ctx.profileId,
      projectId: ctx.projectId,
      taskBudget: ctx.budget,
      tags: [
        'review:adaptive',
        'lane:docs',
        `repo:${identity.repo}`,
        `pr:${identity.pr}`,
        `revision:${identity.head}`,
      ],
      config,
      configSource: source,
    },
    { serialTaskDispatch: true },
  );
  return docsResult(report, taskIds, stages);
}
