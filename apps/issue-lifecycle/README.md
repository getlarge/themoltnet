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
  F -->|ci_failed| G[pr_failed]
  G -->|implement retry| E
  F -->|ci_green| H[agent_pr_reviews]
  H -->|complexity + functional + security| I[reviews_complete]
  I -->|resolve relevant findings| K[review_resolution]
  K -->|ci_failed| G
  K -->|ci_green| L[ready_for_human_review]
  L -->|human merge| M[notify]
  M -->|notify / skip_notify| J[done]
  A -.->|task failed / malformed output| R[lifecycle_recommendation]
  C -.->|task failed / malformed output| R
  E -.->|task failed / malformed output| R
  H -.->|task failed / malformed output| R
  I -.->|task failed / malformed output| R
  M -.->|task failed / malformed output| R
  R -->|stop_blocked / abort / wait_for_human| S[operator action required]
```

The app is intentionally separate from `apps/agent-daemon`: the daemon remains a
generic task executor, while this app encodes one opinionated GitHub issue
lifecycle. It uses Absurd for the durable workflow boundary and MoltNet tasks
for the actual agent work.

## Responsibilities

The runner owns orchestration, not implementation details. It:

- reads the target GitHub issue through the GitHub API
- creates MoltNet `freeform` tasks through `@themoltnet/sdk`
- correlates all tasks with one `correlationId`
- passes prior work forward with `continueFrom`
- links issue and task outputs through task references
- waits for human plan approval through a GitHub label
- waits for green CI before PR review tasks
- creates independent complexity, functional, and security PR review tasks
- creates a review-resolution task that applies only truly relevant findings
- comments the PR as ready for human review after post-fix CI is green, and
  best-effort applies the ready-for-review label when the GitHub App has label
  mutation permission
- creates the final notification/reflection continuation after merge

The agents that claim the generated `freeform` tasks still own their local loop:
reading repo instructions, planning, reviewing, implementing, and reporting the
required lifecycle artifact.

For the general task-system pattern behind this app, see
[Tasks § Durable freeform orchestration](../../docs/use/tasks.md#durable-freeform-orchestration).

## Durable Layer

The durable layer is Absurd (`absurd-sdk`). The app registers one task:

```ts
github_issue_lifecycle;
```

`src/absurd.ts` adapts Absurd's `TaskContext` into the workflow context used by
`src/workflow.ts`:

- `ctx.step(...)` wraps durable side-effect boundaries; keep each external
  mutation in its own step so replay cannot duplicate a partially completed
  batch
- `ctx.awaitEvent(...)` suspends on task, GitHub label, and PR events when an
  event producer is available
- `ctx.sleepFor(...)` remains the timeout fallback for waits whose producers are
  still polled
- `app.spawn(...)` starts one lifecycle run with an idempotency key

The workflow input is normalized before execution, so a missing `correlationId`
is generated once at CLI parse time and reused for task correlation and Absurd
idempotency.

The approval prompt also links to the console task views for that correlation.
By default those links use `https://console.themolt.net`; override with
`--console-url` or `ISSUE_LIFECYCLE_CONSOLE_URL` when testing against a local
console.

### Absurd Database Setup

`absurd-sdk` does not install its own Postgres schema. The database passed to
`--database-url` must already be initialized with `absurdctl`; otherwise startup
fails when the app calls `app.createQueue(...)` and Postgres cannot find
Absurd's `absurd.create_queue(...)` function.

One-off local setup:

```bash
export ABSURD_DATABASE_URL="$ISSUE_LIFECYCLE_DATABASE_URL"
uvx absurdctl init
uvx absurdctl create-queue issue-lifecycle
```

The app still calls `app.createQueue(...)` on startup so the configured queue is
present, but it assumes the Absurd schema and functions have already been
installed. For production-like environments, generate/apply Absurd SQL through
the normal database migration path instead of treating runtime startup as the
schema installer.

See the Absurd docs for
[`absurdctl`](https://earendil-works.github.io/absurd/tools/absurdctl/) and
[database setup and migrations](https://earendil-works.github.io/absurd/guide/database-setup-and-migrations/).
When changing the workflow implementation, also read Absurd's
[concepts](https://earendil-works.github.io/absurd/concepts/) page: completed
steps are checkpoints, while code outside steps may run again during retries.
For agent debugging, install Absurd's bundled skill with
`absurdctl install-skill`; the
[Working With Agents](https://earendil-works.github.io/absurd/agents/) guide
documents that workflow and the `absurdctl` commands agents should reach for
first.

For the repository's local and e2e Docker stacks, this setup is handled by the
`issue-lifecycle-db` and `issue-lifecycle-db-migrate` compose services. They run
Postgres separately from the main MoltNet app DB and initialize the default
`issue-lifecycle` Absurd queue.

## Retry And Recovery Model

The lifecycle runner deliberately decouples orchestration from execution:

- Absurd owns durable workflow state, waits, and retrying the orchestration task
  after process crashes.
- MoltNet owns task persistence, task attempts, accepted outputs, and
  continuation references.
- `apps/agent-daemon` owns claiming and executing the generated `freeform`
  tasks.
- GitHub owns the external human/CI signals: approval labels, PR checks, and
  merge state.

The runner should retry transient orchestration steps such as GitHub reads,
MoltNet task creation, task polling, and PR polling. It should not automatically
retry semantic agent work by rerunning the same task attempt. Instead, it creates
new continuation tasks when the workflow calls for another agent loop:

- plan review findings create a plan-revision task
- failed PR checks create an implementation-retry task
- green PR checks create independent PR review tasks
- PR review outputs create a review-resolution task
- post-review CI failures create an implementation-retry task
- missing human approval is a durable wait, not a failure

When a lifecycle task reaches a terminal failure or returns an invalid lifecycle
artifact, the runner creates a correlated supervisor recommendation task instead
of immediately losing context in an orchestration error. That supervisor task is
freeform, but decision-only: it receives a structured snapshot with the issue,
correlation id, failed task, attempts, daemon messages when available, retry
budgets, and allowed actions. It must emit a `lifecycle_recommendation` artifact
with one allowed next action and a human-readable explanation.

Current allowed supervisor actions are:

- `stop_blocked`: stop because an operator must fix credentials, permissions,
  missing services, or other non-code preconditions
- `abort`: stop because the lifecycle should not continue for this issue
- `wait_for_human`: stop at a human gate that the runner cannot observe yet

The workflow validates the supervisor artifact before applying it. In v1 all
supervisor recommendations stop the workflow with a clear error that includes
the action, classification, confidence, and message. This keeps recovery
decisions durable and inspectable while avoiding hidden blind retries. Future
versions can add executable retry actions after the workflow has explicit
budgets and step builders for them.

`src/absurd.ts` currently registers the workflow with `defaultMaxAttempts: 3`.
That protects the lifecycle worker from short-lived process, network, or API
failures. If the workflow fails because the accepted task artifact is malformed,
the PR retry budget is exhausted, or the review budget is exhausted, that is a
domain failure and should remain visible rather than being hidden by blind
retries.

Recovery expectation:

1. restart the issue-lifecycle process with the same Absurd database and queue
2. Absurd resumes the workflow task from the last durable step
3. already-created MoltNet tasks remain discoverable through their persisted
   task ids and accepted attempts
4. if the runner was stopped while waiting on approval, task completion, or PR
   merge, it resumes the durable event wait or polling fallback instead of
   recreating prior work

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

The final task always creates a reflection diary entry, even when participant
notification is skipped. Its artifact must include `reflectionEntryId`,
`linkedEntryIds`, and `prReflectionUrl`, where `prReflectionUrl` points to the PR
body or PR comment that links the reflection entry.

## Human Gates

Plan approval is never automated. After plan review passes, the runner posts an
idempotent issue comment for the current correlation. That comment includes the
full approved plan, review summary, console links for the related tasks, plan
task id, review task id, and the exact label humans must add.

The runner also maintains one separate status comment per correlation. The
status comment is updated in place as lifecycle milestones change, including
triage, planning, plan review, human approval, implementation, CI waits, agent
PR reviews, review resolution, human PR review, notification/reflection, and completion. Each task-backed status row
links to the console task or accepted attempt when available. This gives humans
a stable place to inspect the active task chain without reading daemon logs.

Only approve after reading the current correlation's prompt. If the approval
label was already present before that prompt appeared, remove it and add it
again after review; a stale label must not silently approve a new plan.

If no implementation task appears after review, check whether the prompt exists
for the current correlation and whether the approval label was re-added after
that prompt.

The skip-notification label skips participant notification only. It does not
skip the final reflection entry or the PR body/comment link to that reflection.

Defaults:

- approval label: `moltnet:plan-approved`
- ready-for-review label: `moltnet:ready-for-review`
- skip notification label: `moltnet:skip-notify`
- poll interval: `30s`
- max plan review rounds: `5`
- max implementation retries: `3`

## CLI

Development form:

```bash
pnpm --filter @themoltnet/issue-lifecycle cli \
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
- `--console-url <url>`: console base URL for task links in approval comments
- `--queue-name <name>`: Absurd queue name
- `--approval-label <label>`: human approval gate
- `--ready-for-review-label <label>`: PR label applied after green CI and
  agent reviews
- `--skip-notify-label <label>`: notification skip gate
- `--github-auth moltnet`: default; mint GitHub App installation tokens from
  `.moltnet/<agent>/moltnet.json`
- `--github-auth env`: use `GH_TOKEN` or `GITHUB_TOKEN`
- `--github-auth gh-cli`: local-only escape hatch that runs `gh` with its
  configured auth instead of the fetch client
- `--poll-interval-sec <n>`: wait interval for labels/tasks/PR status
- `--max-pr-pending-polls <n>`: maximum pending PR-check or merge polls before
  the workflow fails with an operator-actionable error
- `--profiles-config <path>`: per-step runtime profile + task-attempt config
  (JSON). Also read from `ISSUE_LIFECYCLE_PROFILES_CONFIG`. See
  [Per-step runtime profiles](#per-step-runtime-profiles) below.

GitHub auth defaults to a token minted from `.moltnet/<agent>/moltnet.json`
using `@themoltnet/github-agent`. This keeps the lifecycle tied to the selected
agent instead of whatever `gh auth` or shell token happens to be present. The
default client calls the GitHub API directly with `fetch`, retries transient
network/5xx failures, and forces one token refresh on `HTTP 401`. Use
`--github-auth env` only when you explicitly want `GH_TOKEN`/`GITHUB_TOKEN` to
win.

### Per-step runtime profiles

Each lifecycle step can be pinned to a MoltNet **runtime profile** and given a
per-task **`maxAttempts`** via an external JSON file (`--profiles-config <path>`
or `ISSUE_LIFECYCLE_PROFILES_CONFIG`). A runtime profile is a team-scoped,
server-side record that fixes the provider, model, sandbox policy, and lease
limits; pinning a step sets the task's `allowedProfiles` allowlist, so only a
daemon running that profile can claim it. This is how you run, e.g., triage on a
cheap model and security review on a stronger one.

`maxAttempts` is the **MoltNet API task attempt limit** (the `maxAttempts` field
on the created task), not a workflow-level retry. It bounds how many times a
single task may be claimed and attempted before it terminally fails.

The config is **optional** — omitted steps fall back to built-in defaults (no
profile restriction, so any daemon may claim; 3 attempts for reasoning/review
steps, 1 for mutation steps). The file is validated on load (TypeBox); unknown
step keys, malformed UUIDs, or out-of-range attempts fail fast before any task
is created.

Steps: `triage`, `plan`, `planReview`, `planRevision`, `implement`,
`prReviewComplexity`, `prReviewFunctional`, `prReviewSecurity`,
`reviewResolution`, `supervisor`, `notify`. Each entry accepts an optional
`profileId` (UUID) and `maxAttempts` (1–10).

See [`profiles.example.json`](./profiles.example.json) for a full template:

```bash
node apps/issue-lifecycle/dist/main.js \
  --repo getlarge/themoltnet \
  --issue 1327 \
  --database-url "$ISSUE_LIFECYCLE_DATABASE_URL" \
  --profiles-config ./my-profiles.json
```

### Local GitHub App Credentials

For production-parity local e2e, the local agent should be backed by a
persistent GitHub App installation, not by a human `gh auth` session. Store the
agent's MoltNet credentials in the existing local agent directory:

```text
.moltnet/<agent>/moltnet.json
.moltnet/<agent>/env
```

`moltnet.json` must remain uncommitted. It contains the selected agent's
MoltNet credential material plus the GitHub App fields used by the lifecycle
fetch client:

```json
{
  "github": {
    "app_id": "...",
    "installation_id": "...",
    "private_key_path": "/absolute/path/to/github-app.private-key.pem"
  }
}
```

The private key file must also remain uncommitted. The local check for parity
is:

```bash
moltnet github token --credentials ".moltnet/<agent>/moltnet.json"
```

Use `--github-auth env` only for manual simulations that intentionally provide
a known-good `GH_TOKEN`/`GITHUB_TOKEN`. Use `--github-auth gh-cli` only when you
explicitly accept that the runner is using the operator's local GitHub session.
Do not use either mode for CI-like e2e assertions.

## Manual E2E-Stack Smoke Test

Local manual testing needs three moving parts:

1. the MoltNet e2e stack, so the SDK can create/read tasks
2. at least one `apps/agent-daemon` instance, so generated `freeform` tasks are
   actually claimed and executed
3. this issue-lifecycle app, so the durable lifecycle can create continuations
   and wait on GitHub/PR signals

### Prerequisites And Permission Checks

Pick the agent deliberately before starting the daemon:

- For a local smoke that stops at task creation or executes non-GitHub work, use
  a throwaway local agent from `bootstrap-local-agent`.
- For a full lifecycle that opens or updates real GitHub PRs, use an activated
  production agent with GitHub App credentials. A local throwaway agent has no
  GitHub App and should not be expected to run `gh` operations.
- For a production-parity local e2e agent, provision a dedicated persistent
  GitHub App backed test agent and store only its MoltNet credentials under
  `.moltnet/<agent>/`.

Minimum checks:

```bash
# Docker and the local stack must be reachable.
docker info >/dev/null
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml ps

# The dedicated Absurd DB must be initialized by compose.
ABSURD_DATABASE_URL="postgresql://issue_lifecycle:issue_lifecycle_secret@localhost:55434/issue_lifecycle" \
  uvx absurdctl list-queues

# The daemon identity must have local MoltNet credentials.
test -f ".moltnet/<agent>/moltnet.json"
test -f ".moltnet/<agent>/env"
source ".moltnet/<agent>/env"
test -n "$MOLTNET_TEAM_ID"
test -n "$MOLTNET_DIARY_ID"

# Pi/model config must exist before starting apps/agent-daemon.
# The daemon defaults PI_CODING_AGENT_DIR to repo-local .pi.
test -f ".pi/settings.json"
test -f ".pi/models.json"

# For subscription auth, use a local gitignored auth blob.
# For API-key auth, keep .pi/auth.json absent and export the key referenced by
# .pi/models.json, for example OLLAMA_API_KEY.
test -f ".pi/auth.json" || test -n "${OLLAMA_API_KEY:-}"

# The daemon needs a sandbox policy for host commands and workspace mounting.
test -f sandbox.json
```

Task and diary permissions:

- The lifecycle runner creates tasks using the selected `--agent`.
- The daemon should usually run as that same agent for local smoke tests.
- If the daemon runs as a different agent, grant it access to the selected
  `teamId` and writer access to the selected `diaryId` before starting the
  lifecycle. Otherwise it may be able to see a task but fail when producing
  accountable output.
- Generated implementation tasks require a diary entry as part of
  `input.successCriteria.sideEffects`, so diary write access is not optional for
  implementation smoke tests.

GitHub permissions:

- The lifecycle runner itself reads the GitHub issue, labels, comments, and PR
  state with the selected `--agent` GitHub App token by default. The GitHub App
  needs read access to issues, pull requests, metadata, and checks/statuses.
- The runner posts issue and PR comments, so the GitHub App needs write access
  to issues and pull requests for full lifecycle runs.
- The ready-for-review label is best-effort. If the GitHub App cannot mutate
  labels, the runner logs the skipped label write and still posts the human
  review comment.
- The plan approval label defaults to `moltnet:plan-approved`; the issue must be
  in a repository where a human can add that label when the plan is ready.
- Stop before implementation unless the issue, branch, and repository are
  disposable or the agent is intentionally allowed to push branches/open PRs.

Start the normal e2e stack first:

```bash
export NX_LOAD_DOT_ENV_FILES=false
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build
```

The stack includes a dedicated Absurd database for this app:

```bash
ISSUE_LIFECYCLE_DATABASE_URL="postgresql://issue_lifecycle:issue_lifecycle_secret@localhost:55434/issue_lifecycle"
```

Then run an agent daemon against that stack. See
[apps/agent-daemon/README.md](../agent-daemon/README.md) for provisioning a
throwaway agent and smoke-testing task execution.

If the console is running locally, pass its base URL so GitHub approval comments
link back to local task artifacts:

```bash
ISSUE_LIFECYCLE_CONSOLE_URL="http://localhost:5174"
```

Finally, point the lifecycle runner at a Postgres database usable by Absurd and
a sandbox GitHub issue:

```bash
export ISSUE_LIFECYCLE_DATABASE_URL="postgresql://issue_lifecycle:issue_lifecycle_secret@localhost:55434/issue_lifecycle"
export ISSUE_LIFECYCLE_CONSOLE_URL="${ISSUE_LIFECYCLE_CONSOLE_URL:-http://localhost:5174}"

pnpm --filter @themoltnet/issue-lifecycle cli \
  --repo getlarge/themoltnet \
  --issue <sandbox-issue-number>
```

Expected smoke-test path:

1. runner creates a triage freeform task
2. triage completion creates a plan task with `continueFrom`
3. plan review loops until the lifecycle artifact reports pass
4. runner comments on the issue asking for `moltnet:plan-approved`; the comment
   links the correlation task list plus the exact plan and review attempts
5. runner maintains a separate status comment with the current lifecycle stage
   and links to created tasks/attempts
6. runner waits until the issue has `moltnet:plan-approved`
7. initial implementation starts from a fresh session/worktree, gated on the
   approved review task and carrying issue/plan/review task references
8. implementation links a PR via `prNumber`
9. failed checks create another implementation continuation from the prior
   implementation attempt
10. green CI creates independent complexity, functional, and security review
    tasks; those tasks must post PR comments and report the exact comment bodies
    and URLs in their outputs
11. review-resolution continues from implementation, checks PR comments and
    review task outputs, and applies only truly relevant findings
12. CI is checked again after review-resolution; failures return to the
    implementation retry loop
13. green post-review CI applies `moltnet:ready-for-review` and posts a PR
    comment for human review
14. merged PR creates the final notification/reflection continuation
15. final reflection links the lifecycle diary entries and is published in the PR
    body or a PR comment

If the human reviewer is not satisfied after the ready-for-review stage, the v1
runner does not yet watch arbitrary PR review comments and auto-create another
continuation. The intended follow-up is to create a standalone continuation task
for the same correlation that references the PR review comment or task outputs;
a future workflow revision can watch GitHub review/comment events and create
that continuation automatically with dedupe markers.

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
- lifecycle status comment creation/update
- terminal daemon failure supervisor recommendation
- invalid accepted output routed into supervisor recommendation
- PR failed-check retry
- human-review check failure retry/budget exhaustion
- parallel PR review task creation and ready-for-review labeling
- review budget exhaustion
- package build and published-file shape

## References

- [apps/agent-daemon/README.md](../agent-daemon/README.md)
- [docs/start/install-and-initialize.md](../../docs/start/install-and-initialize.md)
- [docs/use/diary-harvesting.md](../../docs/use/diary-harvesting.md)
- [docs/reference/mcp-server.md](../../docs/reference/mcp-server.md)
- [docs/understand/architecture.md](../../docs/understand/architecture.md)
- [Absurd](https://github.com/earendil-works/absurd)
