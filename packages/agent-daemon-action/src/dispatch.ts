/**
 * Dispatch entry — invoked by `actions/github-script` inside the
 * composite action. Reads the issue_comment payload, parses the mention,
 * resolves the correlationId across the four anchors, creates the task
 * (fulfill_brief only in v1), and emits the resulting task-id as an
 * action output. Assess mentions reply with a "deferred, blocked on
 * #881" comment instead of creating a task.
 */

import * as core from '@actions/core';
import type { GitHub } from '@actions/github/lib/utils.js';

import { createTask } from './create-task.js';
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

const ASSESS_DEFERRED_NOTICE =
  '👋 `@moltnet-assess` is recognised but auto-dispatch is **deferred** ' +
  'until the rubric registry lands ([#881](https://github.com/getlarge/themoltnet/issues/881)). ' +
  'For now, create an `assess_brief` task manually via the REST API or MCP and run ' +
  '`moltnet-agent once --task-id <id>` against it.';

export async function dispatch(ctx: DispatchContext): Promise<void> {
  const { context, github, env } = ctx;
  const {
    owner,
    repo,
    isPullRequest,
    issueNumber,
    referenceUrl,
    issueBody,
    issueTitle,
  } = extractContext(context);

  const parsed = parseMention({
    body: context.payload.comment.body,
    isPullRequest,
  });

  if (parsed.verb === null) {
    core.info(`no-op: ${parsed.reason}`);
    return;
  }

  if ('deferred' in parsed && parsed.deferred) {
    core.info(
      `assess deferred (blocked on #${parsed.blockedOn}); posting reply`,
    );
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: ASSESS_DEFERRED_NOTICE,
    });
    return;
  }

  // From here: parsed.verb === 'fulfill', isPullRequest === false.
  const apiUrl = required(env, 'MOLTNET_API_URL');
  const agentToken = required(env, 'MOLTNET_AGENT_TOKEN');
  const teamId = required(env, 'MOLTNET_TEAM_ID');
  const diaryId = required(env, 'MOLTNET_DIARY_ID');

  const correlationId = await resolveCorrelation(
    {
      contextType: 'issue',
      referenceUrl,
    },
    {
      moltnet: {
        async findCorrelationByReference(url) {
          return findCorrelationByRefViaApi({ apiUrl, agentToken, url });
        },
      },
      gh: {
        // PR-only sources are unused for issue context; provide stubs.
        async getPrHeadRef() {
          return null;
        },
        async getPrCommitMessages() {
          return [];
        },
        async getPrBody() {
          return null;
        },
      },
      randomUUID: () => crypto.randomUUID(),
      logger: {
        info: (msg, data) => core.info(`${msg} ${JSON.stringify(data ?? {})}`),
        warn: (msg, data) =>
          core.warning(`${msg} ${JSON.stringify(data ?? {})}`),
      },
    },
  );

  const created = await createTask(
    {
      apiUrl,
      agentToken,
      teamId,
      diaryId,
      correlationId,
      referenceUrl,
      title: issueTitle ?? `Issue #${issueNumber}`,
      brief: issueBody ?? '',
    },
    { fetch },
  );

  core.setOutput('task-id', created.id);
  core.setOutput('correlation-id', correlationId);
  core.info(
    `created fulfill_brief ${created.id} correlationId=${correlationId}`,
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

async function findCorrelationByRefViaApi(args: {
  apiUrl: string;
  agentToken: string;
  url: string;
}): Promise<string | null> {
  const res = await fetch(
    `${args.apiUrl}/tasks?reference_url=${encodeURIComponent(args.url)}&limit=10`,
    { headers: { authorization: `Bearer ${args.agentToken}` } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    items?: { correlationId: string | null }[];
  };
  for (const item of json.items ?? []) {
    if (item.correlationId) return item.correlationId;
  }
  return null;
}
