/**
 * Dispatch entry — invoked by `actions/github-script` inside the
 * composite action. Reads the issue_comment payload, parses the
 * mention, and either:
 *   - **fulfill** (issue context): generates a fresh correlationId,
 *     creates a `fulfill_brief` task with the issue body as the brief,
 *     emits its task-id as an action output. Optional
 *     `input.successCriteria` can be supplied per-proposer (not yet
 *     wired into the action surface; intentional).
 *   - **assess** (PR context): recovers the chain's correlationId
 *     from PR-side anchors, finds the originating fulfill_brief in
 *     that chain, fetches its accepted attempt's outputCid, **inherits
 *     `input.successCriteria` from the fulfill task**, and creates an
 *     `assess_brief` task that judges against the same envelope. If
 *     the originating fulfill carried no successCriteria, posts a
 *     diagnostic comment on the PR instead of creating the task —
 *     there is nothing machine-verifiable to judge.
 *
 * Wrong-context mentions and parse errors are surfaced as info-level
 * logs and (where applicable) PR/issue replies.
 */

import * as core from '@actions/core';
import type { GitHub } from '@actions/github/lib/utils.js';
import type { SuccessCriteria } from '@moltnet/tasks';
import { type Agent, connect } from '@themoltnet/sdk';

import { createAssessTask, createTask } from './create-task.js';
import { parseMention } from './parse-mention.js';
import { resolveCorrelation } from './resolve-correlation.js';

type Octokit = InstanceType<typeof GitHub>;

interface IssueCommentContext {
  payload: {
    comment: { body: string };
    issue: {
      number: number;
      html_url: string;
      title?: string;
      body?: string | null;
      pull_request?: unknown;
    };
    repository: { owner: { login: string }; name: string };
  };
}

export interface DispatchContext {
  github: Octokit;
  context: IssueCommentContext;
  env: NodeJS.ProcessEnv;
}

const NO_CRITERIA_NOTICE =
  '👋 `@moltnet-assess` recognised, but the originating `fulfill_brief` ' +
  'task carried no `input.successCriteria` — there is nothing ' +
  'machine-verifiable to judge against. To enable assessment, the ' +
  'proposer needs to supply `successCriteria` when creating the fulfill ' +
  'task. See [docs/understand/agent-runtime.md](https://github.com/getlarge/themoltnet/blob/main/docs/understand/agent-runtime.md) ' +
  'for the producer/judge model.';

const NO_FULFILL_NOTICE =
  '👋 `@moltnet-assess` recognised, but no `fulfill_brief` task was ' +
  "found in this chain — assess can only run after fulfill. If you're " +
  'sure a fulfill task exists, the chain id may have been lost; check ' +
  'the PR branch name (`moltnet/<correlationId>/...`), the first ' +
  'commit trailer (`Moltnet-Correlation-Id: <id>`), or the marker in ' +
  'the PR body.';

export async function dispatch(ctx: DispatchContext): Promise<void> {
  const { context, github, env } = ctx;
  const extracted = extractContext(context);

  const parsed = parseMention({
    body: context.payload.comment.body,
    isPullRequest: extracted.isPullRequest,
  });

  if (parsed.verb === null) {
    core.info(`no-op: ${parsed.reason}`);
    return;
  }

  // Both verbs need MoltNet creds and the team/diary identifiers.
  // The composite action's materialize step ran `moltnet config
  // init-from-env` and exported MOLTNET_CLIENT_ID / MOLTNET_CLIENT_SECRET /
  // MOLTNET_API_URL into $GITHUB_ENV; connect() with no args picks
  // them up.
  const teamId = required(env, 'MOLTNET_TEAM_ID');
  const diaryId = required(env, 'MOLTNET_DIARY_ID');
  const moltnet = await connect();
  const runningTimeoutSec = parseRunningTimeout(env);

  if (parsed.verb === 'fulfill') {
    await dispatchFulfill({
      moltnet,
      teamId,
      diaryId,
      issueNumber: extracted.issueNumber,
      referenceUrl: extracted.referenceUrl,
      issueTitle: extracted.issueTitle,
      issueBody: extracted.issueBody,
      runningTimeoutSec,
    });
    return;
  }

  // verb === 'assess'
  await dispatchAssess({
    moltnet,
    github,
    teamId,
    diaryId,
    owner: extracted.owner,
    repo: extracted.repo,
    prNumber: extracted.issueNumber,
    referenceUrl: extracted.referenceUrl,
    runningTimeoutSec,
  });
}

/**
 * Resolve the runningTimeoutSec override from
 * `MOLTNET_RUNNING_TIMEOUT_SEC` (set by the action's `running-timeout-sec`
 * input). Returns `undefined` (use server default 7200s) when unset.
 *
 * The action has its own GitHub-side `timeout-minutes` ceiling that
 * SIGKILLs the runner; this server-side cap exists so the queue's view
 * of the task doesn't lag the runner — without it, after the runner
 * dies the task stays "running" up to 2h before lease_expired fires.
 * Operators should set both with the server cap >= the runner cap to
 * avoid the daemon getting cancelled mid-fail-report.
 */
function parseRunningTimeout(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.MOLTNET_RUNNING_TIMEOUT_SEC;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 86400) {
    core.warning(
      `MOLTNET_RUNNING_TIMEOUT_SEC=${raw} is not an integer in [1, 86400]; using server default`,
    );
    return undefined;
  }
  return n;
}

async function dispatchFulfill(args: {
  moltnet: Agent;
  teamId: string;
  diaryId: string;
  issueNumber: number;
  referenceUrl: string;
  issueTitle?: string;
  issueBody?: string | null;
  runningTimeoutSec?: number;
}): Promise<void> {
  const correlationId = await resolveCorrelation(
    { contextType: 'issue', referenceUrl: args.referenceUrl },
    {
      gh: prStubGh(),
      randomUUID: () => crypto.randomUUID(),
      logger: nxLogger(),
    },
  );

  const created = await createTask({
    agent: args.moltnet,
    teamId: args.teamId,
    diaryId: args.diaryId,
    correlationId,
    referenceUrl: args.referenceUrl,
    title: args.issueTitle ?? `Issue #${args.issueNumber}`,
    brief: args.issueBody ?? '',
    runningTimeoutSec: args.runningTimeoutSec,
  });

  core.setOutput('task-id', created.id);
  core.setOutput('correlation-id', correlationId);
  core.info(
    `created fulfill_brief ${created.id} correlationId=${correlationId}`,
  );
}

async function dispatchAssess(args: {
  moltnet: Agent;
  github: Octokit;
  teamId: string;
  diaryId: string;
  owner: string;
  repo: string;
  prNumber: number;
  referenceUrl: string;
  runningTimeoutSec?: number;
}): Promise<void> {
  const pr = { owner: args.owner, repo: args.repo, number: args.prNumber };

  const correlationId = await resolveCorrelation(
    { contextType: 'pr', referenceUrl: args.referenceUrl, pr },
    {
      gh: ghBackedBy(args.github),
      randomUUID: () => crypto.randomUUID(),
      logger: nxLogger(),
    },
  );

  // Look up the originating fulfill_brief in this chain. Order by most
  // recent (server returns newest-first) so a chain with multiple
  // revision-fulfills assesses the latest one.
  const list = await args.moltnet.tasks.list(
    {
      correlationId,
      taskTypes: ['fulfill_brief'],
      limit: 10,
    },
    { teamId: args.teamId },
  );
  const fulfill = list.items?.find((t) => t.acceptedAttemptN !== null);

  if (!fulfill) {
    await postPrComment(args.github, pr, NO_FULFILL_NOTICE);
    core.info(
      `assess: no completed fulfill_brief found for correlationId=${correlationId}`,
    );
    return;
  }

  const successCriteria = (
    fulfill.input as { successCriteria?: SuccessCriteria }
  ).successCriteria;

  if (!successCriteria || !successCriteria.rubric) {
    await postPrComment(args.github, pr, NO_CRITERIA_NOTICE);
    core.info(`assess: fulfill ${fulfill.id} has no successCriteria.rubric`);
    return;
  }

  // Find the accepted attempt's outputCid — required by TaskRef on the
  // assess task's references[].
  const attempts = await args.moltnet.tasks.listAttempts(fulfill.id);
  const accepted = attempts.find(
    (a) => a.attemptN === fulfill.acceptedAttemptN,
  );
  if (!accepted?.outputCid) {
    await postPrComment(
      args.github,
      pr,
      "👋 `@moltnet-assess` cannot resolve the fulfill task's accepted " +
        'attempt outputCid. The fulfill task may not have completed yet.',
    );
    core.info(
      `assess: fulfill ${fulfill.id} accepted attempt has no outputCid`,
    );
    return;
  }

  const created = await createAssessTask({
    agent: args.moltnet,
    teamId: args.teamId,
    diaryId: args.diaryId,
    correlationId,
    targetTaskId: fulfill.id,
    targetOutputCid: accepted.outputCid,
    successCriteria,
    runningTimeoutSec: args.runningTimeoutSec,
  });

  core.setOutput('task-id', created.id);
  core.setOutput('correlation-id', correlationId);
  core.info(
    `created assess_brief ${created.id} for fulfill ${fulfill.id} (correlationId=${correlationId})`,
  );
}

function extractContext(context: IssueCommentContext): {
  owner: string;
  repo: string;
  isPullRequest: boolean;
  issueNumber: number;
  referenceUrl: string;
  issueBody?: string | null;
  issueTitle?: string;
} {
  const owner = context.payload.repository.owner.login;
  const repo = context.payload.repository.name;
  const issue = context.payload.issue;
  return {
    owner,
    repo,
    isPullRequest: Boolean(issue.pull_request),
    issueNumber: issue.number,
    referenceUrl: issue.html_url,
    issueBody: issue.body,
    issueTitle: issue.title,
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v || v.trim() === '') {
    throw new Error(`missing required env: ${key}`);
  }
  return v;
}

function nxLogger() {
  return {
    info: (msg: string, data?: object) =>
      core.info(`${msg} ${JSON.stringify(data ?? {})}`),
    warn: (msg: string, data?: object) =>
      core.warning(`${msg} ${JSON.stringify(data ?? {})}`),
  };
}

function prStubGh() {
  return {
    async getPrHeadRef() {
      return null;
    },
    async getPrCommitMessages() {
      return [];
    },
    async getPrBody() {
      return null;
    },
  };
}

function ghBackedBy(github: Octokit) {
  return {
    async getPrHeadRef(pr: { owner: string; repo: string; number: number }) {
      const r = await github.rest.pulls.get({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
      });
      return r.data.head.ref;
    },
    async getPrCommitMessages(pr: {
      owner: string;
      repo: string;
      number: number;
    }) {
      const r = await github.rest.pulls.listCommits({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        per_page: 50,
      });
      return r.data.map((c) => c.commit.message);
    },
    async getPrBody(pr: { owner: string; repo: string; number: number }) {
      const r = await github.rest.pulls.get({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
      });
      return r.data.body;
    },
  };
}

async function postPrComment(
  github: Octokit,
  pr: { owner: string; repo: string; number: number },
  body: string,
): Promise<void> {
  await github.rest.issues.createComment({
    owner: pr.owner,
    repo: pr.repo,
    issue_number: pr.number,
    body,
  });
}
