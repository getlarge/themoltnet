# Shipping the Agent Daemon — v1 Design

- **Date**: 2026-05-07
- **Issue**: https://github.com/getlarge/themoltnet/issues/1025
- **Status**: Draft, pending implementation plan

## Goal

Make `@themoltnet/agent-daemon` consumable by external repositories so they can run `fulfill_brief` and `assess_brief` tasks against MoltNet from CI, triggered by GitHub issue/PR comment mentions. Single-shot only — no chaining/HITL automation in this spec.

## Non-goals

- Automatic chaining (fulfill → assess → fulfill on `needs_changes`). Emerges naturally once correlation propagation is in place; tracked separately.
- HITL gates / `awaiting_human` task state.
- Hosted GitHub App webhook receiver (vs the workflow template approach taken here).
- Docker image. `npx` with Pi as an npm peer dep covers v1.
- New task types. `fulfill_brief` and `assess_brief` already exist in `libs/tasks/src/task-types/`.
- Pluggable coding agents. Pi-headless only. Extension point documented for later.
- **`@moltnet-assess` mention dispatch** — deferred to a follow-up PR, blocked on rubrics-as-first-class-resource (#881). The daemon itself runs `assess_brief` tasks fine via `once --task-id`; only the _auto-creation from a PR comment_ is deferred, because the dispatcher would need to pick a `criteriaCid` and there is no rubric registry to pick from yet. The mention bot recognizes `@moltnet-assess` and replies with a "deferred, blocked on #881" notice.

## Background

### What already exists

- **`@themoltnet/agent-runtime`** (published) — coding-agent-agnostic Task execution loop with `ApiTaskSource`, `PollingApiTaskSource`, `FileTaskSource`. Pluggable by design.
- **`@themoltnet/pi-extension`** (published) — Pi-headless adapter. Provisions a Gondolin VM, injects MoltNet credentials, executes a task. Currently _requires_ `~/.pi/agent/auth.json` on the host.
- **`@themoltnet/sdk`, `@themoltnet/github-agent`, `@themoltnet/cli`** (published) — auth, GH App tokens, identity helpers.
- **`apps/agent-daemon`** (private) — CLI with `poll`, `once`, `drain` subcommands. Already wires runtime + pi-extension. Per-task `onTaskFinished` finalize hook (#1022).
- **Task types** `fulfill_brief` (output: `{branch, commits, pullRequestUrl, diaryEntryIds, summary}`) and `assess_brief` (rubric-driven scoring, server enforces different agent from producer).
- **`tasks.correlationId`** — existing nullable `uuid` column with index `tasks_correlation_idx WHERE correlation_id IS NOT NULL`. Already in `wire.ts`, REST schemas, and create/list endpoints. **No new schema needed.**
- **Pi native auth** — env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) work without `auth.json`. The `auth.json` requirement is a MoltNet-side constraint in `pi-extension`, not a Pi constraint.

### What is missing

- The daemon is private — external repos can't consume it.
- Pi-extension forces `auth.json` even when env-var providers would suffice.
- No GitHub-native ingress (issue/PR comment → task creation).
- Correlation across the issue ↔ fulfill_PR ↔ assess ↔ revision-fulfill chain has no GitHub-side anchor; an external bot has no way to recover the correlationId without one.

## Architecture

### Distribution

```
External repo
  └─ .github/workflows/moltnet-mention.yml   ← user-copied template
       └─ uses: getlarge/agent-daemon-action  ← packages/agent-daemon-action
            └─ npx @themoltnet/agent-daemon once --task-id $X
                 └─ @themoltnet/agent-runtime
                      └─ @themoltnet/pi-extension
                           └─ Gondolin VM
                                └─ pi-headless (env-var provider auth)
```

Three publishable artifacts touch this flow:

| Artifact                                      | Status               | Change                       |
| --------------------------------------------- | -------------------- | ---------------------------- |
| `@themoltnet/agent-daemon`                    | private → **public** | new                          |
| `@themoltnet/agent-daemon-action` (composite) | does not exist       | new                          |
| `@themoltnet/pi-extension`                    | published, v0.11.0   | minor: optional `piAuthJson` |

### Correlation propagation (multi-anchor)

The mention-bot needs to recover `correlationId` from a GitHub event (issue comment or PR comment). MoltNet is the source of truth, but the bot may run before MoltNet is reachable, or against orphaned PRs. To avoid losing the correlation, the daemon writes it in **four** places when finalizing a `fulfill_brief`. The mention-bot resolves through them in order:

1. **MoltNet API lookup** _(primary)_
   `GET /tasks?reference_url=<pr_or_issue_url>` → first non-null `correlationId`. No GitHub-side artifact needed.

2. **Branch name** — `moltnet/<correlationId>/<slug>`
   Daemon enforces format. Recoverable via `gh pr view --json headRefName`.

3. **First commit trailer** — `Moltnet-Correlation-Id: <uuid>`
   Daemon adds to commit message. Signed → tamper-evident. Recoverable via `git log --grep`. Lost on squash-merge of the PR, but pre-merge lookups still see it.

4. **PR body marker** — `<!-- moltnet-correlation: <uuid> -->`
   Daemon appends to PR body on open. Last resort. Editable by humans.

For a comment on an issue with no prior MoltNet activity, the bot generates a fresh correlationId (`crypto.randomUUID()`) and passes it on `tasks.create`.

**Why four**: each is cheap to write; together they cover GitHub UI bugs, PR body edits, squash merges, MoltNet outages, and orphan PRs. Comment-based markers (originally proposed) are dropped as too fragile.

### Task creation contract

The mention-bot calls existing REST endpoints — no new API surface. The body shape matches `CreateTaskBodySchema` in `apps/rest-api/src/schemas/tasks.ts`:

```
POST /tasks
{
  "taskType": "fulfill_brief",
  "teamId": "<uuid>",     // from repo var MOLTNET_TEAM_ID
  "diaryId": "<uuid>",    // from repo var MOLTNET_DIARY_ID
  "input": { "brief": "...", "title": "..." },
  "references": [{ "url": "<issue_or_pr_url>", "role": "source" }],
  "correlationId": "<uuid>"
}
```

Each repo running the mention-bot configures `MOLTNET_TEAM_ID` and `MOLTNET_DIARY_ID` as repo variables (one-time setup; they identify which MoltNet team owns the work and which diary commits sign against).

For `assess_brief`, the existing schema additionally requires a `criteriaCid` pointing at a rubric diary entry. Because rubric registry UX is mid-redesign (#881), assess auto-creation is deferred — see Non-goals.

## Components

### 1. Publish `@themoltnet/agent-daemon`

**File changes:**

- `apps/agent-daemon/package.json`
  - `private: false`
  - `bin: { "moltnet-agent": "./dist/main.js" }`
  - `publishConfig.exports` mirroring sibling packages (point to `dist/` for consumers)
  - License stays `AGPL-3.0-only`
  - `files: ["dist"]`
- `release-please-config.json` + `.release-please-manifest.json` — register the package
- `.github/workflows/release.yml` — add `publish-agent-daemon` job (copy of `publish-sdk`, with `--access public --provenance`)

**First publish** is manual per CLAUDE.md npm bootstrap procedure (OIDC needs to be configured on npmjs.com before CI can take over):

```bash
pnpm --filter @themoltnet/agent-daemon build
pnpm --filter @themoltnet/agent-daemon publish --access public --no-git-checks
```

Subsequent releases are fully automated by release-please.

**Validation**: `pnpm run check:pack` is already wired across publishable packages; extend the package list if needed. The check verifies `dist/main.js`, `dist/main.d.ts`, no `src/` leaks, and no workspace-protocol bleed.

### 2. Make `pi-extension` `piAuthJson` optional

**File**: `libs/pi-extension/src/vm-manager.ts`

- `VmCredentials.piAuthJson: string | null` (was `string`)
- `loadCredentials`: if `~/.pi/agent/auth.json` does not exist, set `piAuthJson = null` instead of throwing. Document precedence: env-var providers (`ANTHROPIC_API_KEY`, etc.) carried via `creds.agentEnv` are sufficient.
- VM injection: skip `vm.fs.writeFile('/home/agent/.pi/agent/auth.json', ...)` when `piAuthJson` is null.
- Add a config-file path env override `PI_AUTH_PATH` (defaults to `~/.pi/agent/auth.json`) for completeness.

**Tests**: extend `libs/pi-extension/src/vm-manager.test.ts` with the no-auth-file case (env-var provider only).

**Backwards compatibility**: existing local-dev OAuth flows are unchanged — `auth.json` still wins when present, matching Pi's own resolution order.

### 3. Daemon finalize: write correlation in 4 places

**File**: `apps/agent-daemon/src/lib/finalize.ts` (extend) or a new `apps/agent-daemon/src/lib/correlation.ts`

When the active task is `fulfill_brief` and `correlationId` is non-null on the claimed task, the finalize hook ensures:

- **Branch name** — daemon picks `moltnet/<correlationId>/<slug-from-brief-title>` _before_ committing. If the branch is supplied externally (e.g. agent created it differently), warn and rename via `git branch -m`.
- **First commit trailer** — daemon ensures the first commit on the branch has `Moltnet-Correlation-Id: <uuid>` in its trailers. If absent (agent wrote a commit without it), append via `git commit --amend` _before push_ and only if no signature would be invalidated; otherwise rely on the other anchors and log a warning.
- **PR body marker** — when `pullRequestUrl` is present in the output, the daemon issues `gh api -X PATCH repos/.../pulls/<n>` to append `\n\n<!-- moltnet-correlation: <uuid> -->` to the PR body. Idempotent: skip if marker already present.
- **MoltNet `references`** — already populated by the agent via the task-type contract; finalize verifies the issue/PR URLs are present so the API-side lookup works.

If any of the three GitHub-side writes fails, finalize logs and continues — the API-side lookup is the primary anchor and does not depend on these.

### 4. `packages/agent-daemon-action`

A composite GitHub Action distributed via GitHub release tags from this monorepo. Consumers reference `uses: getlarge/themoltnet/packages/agent-daemon-action@v<n>` (or a SHA). Release-please cuts the tag; no separate marketplace publish in v1.

**`action.yml` inputs:**

- `task-id` _(required)_ — the MoltNet task to claim and execute
- `mode` _(default `once`)_ — `once` | `drain`. `poll` is documented but discouraged for CI cost reasons.
- `node-version` _(default `22`)_ — passed to setup-node
- `daemon-version` _(default = the action's version)_ — pinned npm range for `npx`

**Steps:**

1. `actions/checkout@v4`
2. `actions/setup-node@v4` with the requested node version
3. Materialize agent credentials: write `${{ secrets.MOLTNET_AGENT_KEY }}` → `$RUNNER_TEMP/.moltnet/agent/moltnet.json` (mode 0600); write `${{ secrets.MOLTNET_AGENT_GITCONFIG }}` → `…/gitconfig`. Export `GIT_CONFIG_GLOBAL` accordingly.
4. `npx @themoltnet/agent-daemon@${{ inputs.daemon-version }} ${{ inputs.mode }} --task-id ${{ inputs.task-id }}`
5. On failure: surface daemon stderr, exit non-zero.

**Provider auth** is via standard env vars (`ANTHROPIC_API_KEY`, etc.), set by the calling workflow under a GitHub Environment so they get approval gates if desired.

**`action.yml` outputs:** `task-status`, `pull-request-url` (parsed from daemon stdout via a small JSON marker the daemon emits on completion).

### 5. Mention-bot workflow template

**Path**: `docs/examples/workflows/moltnet-mention.yml` (template — users copy into their repos)

```yaml
on:
  issue_comment:
    types: [created]

jobs:
  dispatch:
    if: contains(github.event.comment.body, '@moltnet-')
    runs-on: ubuntu-latest
    environment: moltnet # gates approval; holds secrets
    steps:
      - id: parse
        uses: actions/github-script@v7
        env:
          MOLTNET_API_URL: ${{ vars.MOLTNET_API_URL }}
          MOLTNET_AGENT_KEY: ${{ secrets.MOLTNET_AGENT_KEY }}
        with:
          script: |
            // Detect verb (@moltnet-fulfill / @moltnet-assess)
            // Detect context (issue.pull_request → assess; else → fulfill)
            // Resolve correlationId via 4-source chain
            // POST /tasks → returns task.id
            // core.setOutput('task-id', taskId)
      - uses: getlarge/agent-daemon-action@v1
        with:
          task-id: ${{ steps.parse.outputs.task-id }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

**Resolution order in the script** (correlation):

```js
async function resolveCorrelation({
  contextType,
  issueOrPrUrl,
  headRef,
  prBody,
}) {
  // 1. MoltNet API
  const r = await fetch(
    `${MOLTNET_API_URL}/tasks?reference_url=${encodeURIComponent(issueOrPrUrl)}`,
    { headers: authHeaders },
  );
  for (const t of (await r.json()).items ?? [])
    if (t.correlationId) return t.correlationId;

  if (contextType === 'pr') {
    // 2. Branch name
    const m = headRef?.match(/^moltnet\/([0-9a-f-]{36})\//i);
    if (m) return m[1];

    // 3. Commit trailer (last 50 commits on PR head)
    const commits = await gh.api(
      `repos/${repo}/pulls/${num}/commits?per_page=50`,
    );
    for (const c of commits) {
      const m = c.commit.message.match(
        /^Moltnet-Correlation-Id:\s*([0-9a-f-]{36})/im,
      );
      if (m) return m[1];
    }

    // 4. PR body marker
    const m2 = prBody?.match(
      /<!--\s*moltnet-correlation:\s*([0-9a-f-]{36})\s*-->/i,
    );
    if (m2) return m2[1];
  }

  // Issue with no history, or PR with all anchors lost: fresh id
  return crypto.randomUUID();
}
```

Ship the script as a small reusable module in the action, not inline JS in the workflow, so users don't copy 80 lines of YAML. The workflow template is then ~30 lines.

### 6. Docs

- `apps/agent-daemon/README.md` _(new)_ — config surface (env vars and CLI flags), the three modes, examples for local + CI.
- `packages/agent-daemon-action/README.md` _(new)_ — secrets schema, GitHub Environment setup, link to `legreffier init` for credential provisioning, troubleshooting.
- `docs/examples/workflows/moltnet-mention.yml` _(new)_ — copy-paste template.
- `docs/agent-daemon-shipping.md` _(new, short)_ — entry-point doc linking the above and explaining the issue/PR mention UX with a sequence diagram.

## Required GitHub Action secrets (per repo)

Scoped to a GitHub Environment (`moltnet`) for approval gates:

| Secret                              | Purpose                                                     |
| ----------------------------------- | ----------------------------------------------------------- |
| `MOLTNET_AGENT_KEY`                 | JSON contents of agent's `moltnet.json`                     |
| `MOLTNET_AGENT_GITCONFIG`           | gitconfig (or generated by `legreffier init`)               |
| `GITHUB_APP_PRIVATE_KEY`            | agent's GH App key (consumed by `@themoltnet/github-agent`) |
| `ANTHROPIC_API_KEY` _or equivalent_ | Pi provider auth via env var                                |
| `PI_AUTH_JSON` _(optional)_         | only for OAuth-subscription auth                            |

Agent provisioning is a one-time per-repo setup performed via `legreffier init` on a developer machine, then secrets are uploaded to the repo's `moltnet` environment. Friction acknowledged; not solved here.

## Error handling

- **Credential resolution failure** in the Action — fail-fast with explicit message naming the missing secret.
- **Pi provider unauthenticated** — daemon surfaces Pi's error verbatim; Action exits non-zero.
- **MoltNet API unreachable from the bot** — bot falls back to anchors 2–4, then to a fresh correlationId. Logged as warning. Once API recovers, future tasks on the same PR resolve correctly via the persisted anchors.
- **Branch / trailer / PR body write fails** — daemon logs and continues. The API anchor is sufficient.
- **Task lease expiry** — existing daemon behavior; the per-task `onTaskFinished` hook (#1022) ensures clean finalization on poll-mode loops; for `once` mode the runner exits before lease expiry under normal load.
- **Squash merge** drops the commit trailer from the merged history but pre-merge lookups (when assess runs) still see it. Branch name + PR body + API lookup cover post-merge needs.

## Testing

- **Unit**:
  - `apps/agent-daemon/src/lib/options.test.ts` — extend for new config keys (none currently planned beyond what exists; verify after planning).
  - New `apps/agent-daemon/src/lib/correlation.test.ts` — the 4-anchor write logic in finalize, with mocked `gh` calls.
  - `libs/pi-extension/src/vm-manager.test.ts` — env-var-provider path with `piAuthJson = null`.
  - `packages/agent-daemon-action/__tests__/resolve-correlation.test.ts` — the 4-source resolution logic.
- **E2E** (existing stack at `docker-compose.e2e.yaml`):
  - Extend `apps/agent-daemon/e2e/daemon.e2e.test.ts` with one happy-path `assess_brief` claim that asserts the same `correlationId` on input and output.
- **Integration with real GitHub**: not in v1. Manual dogfooding against a private test repo before public release.

## Acceptance criteria

- [ ] `npm i -g @themoltnet/agent-daemon && moltnet-agent --help` works on a clean machine.
- [ ] `loadCredentials` succeeds without `~/.pi/agent/auth.json` when `ANTHROPIC_API_KEY` (or any supported provider env var) is set.
- [ ] In a test repo with the mention-bot workflow + secrets configured:
  - `@moltnet-fulfill` on an issue → MoltNet task created with fresh correlationId → daemon opens a PR with branch `moltnet/<uuid>/...`, first commit has `Moltnet-Correlation-Id` trailer, PR body contains the marker.
  - `@moltnet-assess` on that PR → mention-bot replies with "deferred, blocked on #881" notice; no task is created. _(Auto-dispatch deferred; manual `assess_brief` creation via REST + `moltnet-agent once --task-id` still works end-to-end.)_
  - `tasks.list({ correlationId })` returns the fulfill task with the matching correlationId.

## Risks

- **Per-repo agent provisioning** — friction for adopters. Out of scope; called out in docs.
- **Cost control** — `poll` in CI is unbounded. Mitigated by defaulting to `once`.
- **Branch name aesthetics** — `moltnet/<uuid>/<slug>` is ugly; accepted (agent-authored).
- **`git commit --amend` on already-pushed commits** — daemon must amend _before_ the first push. Spec'd, but a careful implementation point.
- **AGPL-3.0-only on the daemon binary** — external repos consume via `npx`, not import; AGPL is fine for that mode and matches `agent-runtime`. Confirmed.

## Follow-ups (separate issues)

- **`@moltnet-assess` auto-dispatch** — once #881 lands, dispatcher can resolve a rubric CID and create `assess_brief` tasks from PR comments. Gates on rubric registry shape.
- **GitHub Marketplace listing for `agent-daemon-action`** — Marketplace requires `action.yml` at the _repository root_ and a repository with no workflow files. The current monorepo path-based layout (`uses: getlarge/themoltnet/packages/agent-daemon-action@<ref>`) works for `uses:` resolution but is ineligible for Marketplace. A follow-up extracts the action to a dedicated `getlarge/agent-daemon-action` repo whose contents (action.yml, dist/main.js, README.md, LICENSE) are pushed by a release workflow on every release-please tag.
- Auto-chaining: `assess_brief.finalize` creates next `fulfill_brief` on `verdict=needs_changes`, reusing correlationId.
- HITL gate: `awaiting_human` task state surfaced in console.
- Docker image for non-npm CI environments.
- Hosted GitHub App alternative to the workflow template.
- Move provider env-var passthrough into a typed pi-extension config rather than ambient process.env.
