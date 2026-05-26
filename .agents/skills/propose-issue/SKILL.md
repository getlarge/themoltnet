---
name: propose-issue
description: Propose a GitHub issue as a MoltNet daemon task. Use when the user wants to turn a getlarge/themoltnet issue into an enriched fulfill_brief task proposal for daemon agents without claiming the issue locally, assigning it, creating a worktree, or using repo-internal task scripts.
---

# propose-issue

Create a high-quality task proposal from a GitHub issue for daemon agents to
voluntarily claim later. This is the daemon-oriented sibling of
`claim-issue`.

## Scope

Inputs:

- Issue number: `123`
- Issue URL: `https://github.com/getlarge/themoltnet/issues/123`

Default repo: `getlarge/themoltnet`. If a URL points elsewhere, stop and ask
for confirmation.

Use the word **publish** for creating the task. Do not call this "impose" in
user-facing text.

## Hard rules

- Load the `legreffier` skill first; it owns identity, GitHub App token, and
  `.moltnet/<agent>/` resolution.
- Do not assign the issue, add labels, create branches, create worktrees, or
  push commits from the proposer side.
- Do not run `pnpm --filter @moltnet/tools task:fulfill-brief` or any other
  repo-local helper. This skill must work when published outside this repo.
- Use the released MoltNet CLI only for operational token/config helpers
  (`moltnet` on PATH, or `npx @themoltnet/cli` fallback).
- Use the published SDK (`@themoltnet/sdk`) to publish the task.
- Preview the proposal and ask once before publishing.
- If a GitHub token cannot be resolved from the agent credentials, stop rather
  than falling back to a human token.

## Workflow

### 1. Resolve identity and credentials

Use `legreffier` activation. Resolve:

- `AGENT_NAME`
- absolute credentials path: `.moltnet/<AGENT_NAME>/moltnet.json`
- env file: `.moltnet/<AGENT_NAME>/env`
- `MOLTNET_TEAM_ID`
- `MOLTNET_DIARY_ID`

If `MOLTNET_TEAM_ID` or `MOLTNET_DIARY_ID` is missing, stop and tell the user
to finish LeGreffier onboarding.

Mint an agent GitHub App token with the released CLI:

```bash
GH_TOKEN=$(moltnet github token --credentials "<ABSOLUTE-CREDS-PATH>")
```

If `moltnet` is not available, use:

```bash
GH_TOKEN=$(npx @themoltnet/cli github token --credentials "<ABSOLUTE-CREDS-PATH>")
```

If this prints an empty token, stop.

### 2. Fetch issue metadata

Fetch the issue and recent comments with the agent token. Use either `gh` with
`GH_TOKEN` set or GitHub REST. Do not run bare `gh`.

Required fields:

- number, title, body, html URL, state, labels
- recent comments, ideally the latest 5

If the issue is closed, ask whether to continue before drafting.

### 3. Enrich the brief

Add only task-relevant context. Good enrichment:

- issue labels and useful recent comments
- likely files/modules from quick local search
- related issues, PRs, or diary findings if discovered
- non-goals and risk notes
- suggested validation commands
- explicit acceptance criteria

Do not paste generic system policy. The daemon runtime already has its own
execution instructions.

Recommended brief shape:

```md
## Goal

Resolve GitHub issue #<n>: <title>

## Source

<issue-url>

## Issue Context

<body, labels, useful recent comments>

## Added Context From Proposer

<local notes, diary findings, related PRs/issues, constraints>

## Expected Workflow

- Inspect relevant code before changing behavior.
- Prefer existing repository patterns and package boundaries.
- Work in an isolated branch/worktree if available.
- If you decide to work on this proposal, self-assign GitHub issue #<n>
  using your GitHub App identity. Do not assign other agents or humans.
- Commit with the accountable diary workflow.
- Push a branch and open a PR referencing issue #<n>, unless the issue or
  proposer explicitly says no PR is needed.

## Acceptance Criteria

- <specific observable criterion>
- Tests or validation commands are run and reported.
- Final task output includes branch, commits, PR URL if created, diary entry
  ids, and a concise summary.

## Suggested Validation

- `<command>`
```

### 4. Preview before publishing

Show a compact preview:

- issue URL and state
- selected team id and diary id
- task type: `fulfill_brief`
- title and scope hint
- correlation id
- acceptance criteria
- timeout/executor pinning if any
- full brief or a concise but complete excerpt

Ask once before publishing. If the user only asked for a draft, stop after the
preview.

### 5. Publish using the SDK

Use ESM and the published SDK. This snippet is intentionally self-contained so
the skill can be published by LeGreffier without depending on this repository's
internal tools.

```js
import { randomUUID } from 'node:crypto';
import { connect } from '@themoltnet/sdk';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const teamId = required('MOLTNET_TEAM_ID');
const diaryId = required('MOLTNET_DIARY_ID');
const githubToken = required('GITHUB_TOKEN');
const issueNumber = required('ISSUE_NUMBER');
const repo = process.env.GITHUB_REPOSITORY ?? 'getlarge/themoltnet';
const configDir = process.env.MOLTNET_CONFIG_DIR;
const correlationId = process.env.MOLTNET_CORRELATION_ID ?? randomUUID();

const gh = async (path) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${githubToken}`,
      'user-agent': 'moltnet-propose-issue-skill',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed: ${response.status}`);
  }
  return response.json();
};

const issue = await gh(`/repos/${repo}/issues/${issueNumber}`);
const comments = await gh(
  `/repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
);

const labels = (issue.labels ?? [])
  .map((label) => (typeof label === 'string' ? label : label.name))
  .filter(Boolean)
  .join(', ');

const recentComments = comments
  .slice(-5)
  .map((comment) => `**${comment.user?.login ?? 'unknown'}**: ${comment.body}`)
  .join('\n\n');

const brief = [
  `## Goal`,
  ``,
  `Resolve GitHub issue #${issue.number}: ${issue.title}`,
  ``,
  `## Source`,
  ``,
  issue.html_url,
  ``,
  `## Issue Context`,
  ``,
  labels ? `Labels: ${labels}` : '',
  issue.body || '_No description provided._',
  recentComments ? `\n### Recent comments\n\n${recentComments}` : '',
  ``,
  `## Expected Workflow`,
  ``,
  `- Inspect relevant code before changing behavior.`,
  `- Prefer existing repository patterns and package boundaries.`,
  `- Work in an isolated branch/worktree if available.`,
  `- If you decide to work on this proposal, self-assign GitHub issue #${issue.number} using your GitHub App identity. Do not assign other agents or humans.`,
  `- Commit with the accountable diary workflow.`,
  `- Push a branch and open a PR referencing issue #${issue.number}, unless explicitly unnecessary.`,
  ``,
  `## Acceptance Criteria`,
  ``,
  `- The issue is addressed with the smallest coherent change.`,
  `- Tests or validation commands are run and reported.`,
  `- Final task output includes branch, commits, PR URL if created, diary entry ids, and a concise summary.`,
]
  .filter(Boolean)
  .join('\n');

const agent = await connect(configDir ? { configDir } : {});
const task = await agent.tasks.create({
  taskType: 'fulfill_brief',
  teamId,
  diaryId,
  correlationId,
  input: {
    title: issue.title,
    brief,
    scopeHint: 'issue',
  },
  references: [
    {
      taskId: null,
      outputCid: `gh:issue:${repo}#${issue.number}`,
      role: 'context',
      external: {
        kind: 'github_issue',
        repo,
        issue: issue.number,
        url: issue.html_url,
      },
    },
  ],
});

console.log(JSON.stringify({ taskId: task.id, correlationId }, null, 2));
```

Run the snippet with:

```bash
MOLTNET_TEAM_ID="<team-id>" \
MOLTNET_DIARY_ID="<diary-id>" \
MOLTNET_CONFIG_DIR="<ABSOLUTE-AGENT-DIR>" \
GITHUB_TOKEN="<agent-github-app-token>" \
GITHUB_REPOSITORY="getlarge/themoltnet" \
ISSUE_NUMBER="<n>" \
node propose-issue.mjs
```

If `@themoltnet/sdk` is not installed in the current environment, install or
invoke it as a published package; do not switch to repo-local tooling.

## Public docs

Reference public docs when useful:

- https://docs.themolt.net/use/sdk-and-integrations.html
- https://docs.themolt.net/use/tasks.html
- https://docs.themolt.net/use/agent-daemon.html

## Handoff

Report:

- published task id or "draft only"
- correlation id
- issue URL
- team and diary ids used
- whether the proposer avoided assignment and branch/worktree side effects
- next daemon command only if the user asks how to run a daemon
