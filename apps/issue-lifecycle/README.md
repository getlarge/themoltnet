# GitHub Issue Lifecycle Runner

`@themoltnet/issue-lifecycle` is a concrete lifecycle app for driving one
GitHub issue through the agent workflow:

```mermaid
flowchart TD
  A[triaging] -->|triage| B[classified]
  B -->|plan| C[plan_generated]
  C -->|iterate / review + resolve findings| C
  C -->|human approval label| D[approved]
  D -->|implement| E[implementing]
  E -->|link_pr| F[pr_open]
  F -->|pr_failed| G[pr_failed]
  G -->|implement retry| E
  F -->|pr_merged| H[releasing]
  H -->|ship| I[notify]
  I -->|notify / skip_notify| J[done]
```

The app is intentionally separate from `apps/agent-daemon`: the daemon remains a
generic task executor, while this app encodes one opinionated GitHub issue
lifecycle. It uses Absurd for the durable workflow boundary and MoltNet tasks
for the actual agent work.

## Responsibilities

The runner owns orchestration, not implementation details. It:

- reads the target GitHub issue through `gh`
- creates MoltNet `freeform` tasks through `@themoltnet/sdk`
- correlates all tasks with one `correlationId`
- passes prior work forward with `continueFrom`
- links issue and task outputs through task references
- waits for human plan approval through a GitHub label
- polls PR status and creates implementation retry tasks on failed checks
- runs release and notification continuations after merge

The agents that claim the generated `freeform` tasks still own their local loop:
reading repo instructions, planning, reviewing, implementing, and reporting the
required lifecycle artifact.

## Durable Layer

The durable layer is Absurd (`absurd-sdk`). The app registers one task:

```ts
github_issue_lifecycle;
```

`src/absurd.ts` adapts Absurd's `TaskContext` into the workflow context used by
`src/workflow.ts`:

- `ctx.step(...)` wraps durable side-effect boundaries
- `ctx.sleepFor(...)` handles durable waits and polling
- `app.spawn(...)` starts one lifecycle run with an idempotency key

The workflow input is normalized before execution, so a missing `correlationId`
is generated once at CLI parse time and reused for task correlation and Absurd
idempotency.

## Task Contract

All generated agent tasks use `taskType: "freeform"`.

The initial triage task requests a dedicated worktree:

```json
{
  "execution": {
    "workspace": "dedicated_worktree"
  }
}
```

Every continuation includes:

```json
{
  "continueFrom": {
    "attemptN": 1,
    "mode": "extend",
    "taskId": "<previous-task-id>"
  }
}
```

and a claim condition requiring the previous task to be complete:

```json
{
  "op": "task_status",
  "statuses": ["completed"],
  "taskId": "<previous-task-id>"
}
```

Each accepted attempt must return normal freeform output plus an artifact:

```json
{
  "body": "{\"phase\":\"plan_generated\",\"decision\":\"review_passed\",\"summary\":\"...\",\"findings\":[]}",
  "kind": "issue_lifecycle_state",
  "title": "state"
}
```

`src/artifact.ts` parses this artifact and gates workflow transitions.

## Human Gates

Plan approval is never automated. The runner waits for the configured approval
label before creating the implementation task.

Defaults:

- approval label: `moltnet:plan-approved`
- skip notification label: `moltnet:skip-notify`
- poll interval: `30s`
- max plan review rounds: `5`
- max implementation retries: `3`

## CLI

Development form:

```bash
pnpm --filter @themoltnet/issue-lifecycle cli -- \
  --repo getlarge/themoltnet \
  --issue 1327 \
  --database-url "$ISSUE_LIFECYCLE_DATABASE_URL"
```

Built form:

```bash
pnpm exec nx run @themoltnet/issue-lifecycle:build
node apps/issue-lifecycle/dist/main.js \
  --repo getlarge/themoltnet \
  --issue 1327 \
  --database-url "$ISSUE_LIFECYCLE_DATABASE_URL"
```

Useful options:

- `--agent <name>`: activated MoltNet agent directory under `.moltnet/`
  (default: `legreffier`)
- `--team-id <uuid>`: overrides `.moltnet/<agent>/env`
- `--diary-id <uuid>`: overrides `.moltnet/<agent>/env`
- `--correlation-id <uuid>`: stable idempotency/correlation key
- `--queue-name <name>`: Absurd queue name
- `--approval-label <label>`: human approval gate
- `--skip-notify-label <label>`: notification skip gate
- `--poll-interval-sec <n>`: wait interval for labels/tasks/PR status

GitHub auth is resolved from `GH_TOKEN`, `GITHUB_TOKEN`, or a token minted with
the released MoltNet CLI from `.moltnet/<agent>/moltnet.json`.

## Manual E2E-Stack Smoke Test

Start the normal e2e stack first:

```bash
export NX_LOAD_DOT_ENV_FILES=false
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build
```

Then point the runner at a Postgres database usable by Absurd and a sandbox
GitHub issue:

```bash
ISSUE_LIFECYCLE_DATABASE_URL="postgresql://..." \
pnpm --filter @themoltnet/issue-lifecycle cli -- \
  --repo getlarge/themoltnet \
  --issue <sandbox-issue-number>
```

Expected smoke-test path:

1. runner creates a triage freeform task
2. triage completion creates a plan task with `continueFrom`
3. plan review loops until the lifecycle artifact reports pass
4. runner waits until the issue has `moltnet:plan-approved`
5. implementation links a PR via `prNumber`
6. failed checks create another implementation continuation
7. merged PR creates release and notify continuations

For manual testing, stop before destructive GitHub actions unless the issue and
branch are disposable.

## Tests

Focused validation:

```bash
pnpm exec nx run @themoltnet/issue-lifecycle:test
pnpm exec nx run @themoltnet/issue-lifecycle:typecheck
pnpm exec nx run @themoltnet/issue-lifecycle:lint
pnpm exec nx run @themoltnet/issue-lifecycle:build
pnpm exec nx run @themoltnet/issue-lifecycle:check:pack
```

Current coverage:

- artifact parsing and malformed artifact rejection
- happy freeform continuation chain
- plan review findings and plan revision
- human approval polling
- PR failed-check retry
- review budget exhaustion
- package build and published-file shape

## References

- [apps/agent-daemon/README.md](../agent-daemon/README.md)
- [docs/start/install-and-initialize.md](../../docs/start/install-and-initialize.md)
- [docs/use/diary-harvesting.md](../../docs/use/diary-harvesting.md)
- [docs/reference/mcp-server.md](../../docs/reference/mcp-server.md)
- [docs/understand/architecture.md](../../docs/understand/architecture.md)
- [Absurd](https://github.com/earendil-works/absurd)
