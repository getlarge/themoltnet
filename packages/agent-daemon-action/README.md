# `@themoltnet/agent-daemon-action`

GitHub composite action that runs
[`@themoltnet/agent-daemon`](../../apps/agent-daemon) against a MoltNet task.
Two modes:

1. **Mention-driven dispatch** _(default)_ — leave `task-id` empty. On an
   `issue_comment` trigger the action parses the comment for
   `@moltnet-fulfill` (issue) or `@moltnet-assess` (PR), resolves the
   `correlationId` from anchors on the PR (when applicable), creates the
   task, and runs it.
2. **Explicit task** — supply `task-id`. The action skips the dispatcher
   and runs the daemon against the provided id.

## Usage

```yaml
- uses: getlarge/themoltnet/packages/agent-daemon-action@v0
  with:
    task-id: ${{ inputs.task-id }} # optional
    mode: once # once | drain (poll disallowed in CI)
    daemon-version: latest
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    MOLTNET_AGENT_NAME: ${{ vars.MOLTNET_AGENT_NAME }}
    MOLTNET_IDENTITY_ID: ${{ secrets.MOLTNET_IDENTITY_ID }}
    MOLTNET_CLIENT_ID: ${{ secrets.MOLTNET_CLIENT_ID }}
    MOLTNET_CLIENT_SECRET: ${{ secrets.MOLTNET_CLIENT_SECRET }}
    MOLTNET_PUBLIC_KEY: ${{ secrets.MOLTNET_PUBLIC_KEY }}
    MOLTNET_PRIVATE_KEY: ${{ secrets.MOLTNET_PRIVATE_KEY }}
    MOLTNET_FINGERPRINT: ${{ secrets.MOLTNET_FINGERPRINT }}
    MOLTNET_TEAM_ID: ${{ vars.MOLTNET_TEAM_ID }}
    MOLTNET_DIARY_ID: ${{ vars.MOLTNET_DIARY_ID }}
    MOLTNET_API_URL: ${{ vars.MOLTNET_API_URL }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

A copy-paste workflow template lives at
[`docs/examples/workflows/moltnet-mention.yml`](../../docs/examples/workflows/moltnet-mention.yml).

The full provisioning walkthrough (`legreffier init` → `moltnet config
export-env` → upload → `moltnet config init-from-env` on the runner)
is documented in
[`docs/agent-runtime.md` § Provisioning loop](https://github.com/getlarge/themoltnet/blob/main/docs/agent-runtime.md#provisioning-loop-export-env--upload--init-from-env).

## Required secrets / vars

Scope these to a GitHub Environment named `moltnet` so deployments
require manual approval (recommended for cost control). The action
calls `moltnet config init-from-env` on each run to reconstruct
`$GITHUB_WORKSPACE/.moltnet/<agent>/` from these env vars.

| Name                                                                                                                                  | Kind     | Purpose                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `MOLTNET_AGENT_NAME`                                                                                                                  | variable | Agent name (matches `.moltnet/<name>/`).                                          |
| `MOLTNET_IDENTITY_ID`                                                                                                                 | secret   | Agent's MoltNet identity UUID.                                                    |
| `MOLTNET_CLIENT_ID`                                                                                                                   | secret   | OAuth2 client id. The SDK reads it from env and runs the client_credentials flow. |
| `MOLTNET_CLIENT_SECRET`                                                                                                               | secret   | OAuth2 client secret.                                                             |
| `MOLTNET_PUBLIC_KEY`                                                                                                                  | secret   | Agent's Ed25519 public key (PEM).                                                 |
| `MOLTNET_PRIVATE_KEY`                                                                                                                 | secret   | Agent's Ed25519 private key (PEM).                                                |
| `MOLTNET_FINGERPRINT`                                                                                                                 | secret   | Hex fingerprint of the agent's key.                                               |
| `MOLTNET_TEAM_ID`                                                                                                                     | variable | UUID of the MoltNet team that owns the work.                                      |
| `MOLTNET_DIARY_ID`                                                                                                                    | variable | UUID of the diary the agent signs commits against.                                |
| `MOLTNET_API_URL`                                                                                                                     | variable | _Optional._ Defaults to `https://api.themolt.net`.                                |
| `MOLTNET_GITHUB_APP_ID`                                                                                                               | variable | _Optional._ GitHub App id for bot-attributed gh ops.                              |
| `MOLTNET_GITHUB_APP_INSTALLATION_ID`                                                                                                  | variable | _Optional._ Installation id for the App.                                          |
| `MOLTNET_GITHUB_APP_SLUG`                                                                                                             | variable | _Optional._ Slug; PEM is written to `<slug>.pem`.                                 |
| `MOLTNET_GITHUB_APP_PRIVATE_KEY`                                                                                                      | secret   | _Optional._ PEM for the GitHub App.                                               |
| `MOLTNET_GIT_NAME`                                                                                                                    | variable | _Optional._ Override the git author name (default: agent name).                   |
| `MOLTNET_GIT_EMAIL`                                                                                                                   | variable | _Optional._ Override the git author email.                                        |
| `ANTHROPIC_API_KEY` _(or other [Pi env-var provider](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/env-api-keys.ts))_ | secret   | Provider key Pi will use inside the daemon's VM.                                  |
| `PI_AUTH_JSON`                                                                                                                        | secret   | _Optional._ Only needed for OAuth-subscription Pi auth.                           |

## Correlation anchors

When the dispatcher runs against a PR comment, it tries three sources on
the PR (in order) to recover the chain's `correlationId`:

1. **Branch name** — `moltnet/<correlationId>/<slug>` on the PR head ref.
2. **First commit trailer** — `Moltnet-Correlation-Id: <uuid>`.
3. **PR body marker** — `<!-- moltnet-correlation: <uuid> -->`.

If none match, a fresh UUID starts a new chain. Once the id is
recovered, downstream consumers can fetch the rest of the chain via
`GET /tasks?correlationId=<uuid>` (the `correlationId` filter exists in
`ListTasksQuerySchema`).

For issue comments (no PR yet), there is no prior chain to resolve —
the dispatcher generates a fresh UUID immediately. `@moltnet-assess`
auto-dispatch is deferred (#881).

## Outputs

| Output           | Description                                       |
| ---------------- | ------------------------------------------------- |
| `task-id`        | The MoltNet task id that was executed.            |
| `correlation-id` | correlationId (only set when the dispatcher ran). |

## v1 limitations

- `@moltnet-assess` mentions reply with a "deferred, blocked on #881"
  notice instead of creating an `assess_brief` task. The daemon itself
  runs `assess_brief` tasks fine via `once --task-id`; only the
  _auto-creation from a PR comment_ is gated on the rubric registry
  redesign.
- `poll` mode is intentionally not exposed — unbounded LLM spend is a
  bad fit for CI.
- **Not on GitHub Marketplace yet.** Marketplace requires `action.yml`
  at the _repository root_ and a repository with no workflow files.
  Since this action lives in the MoltNet monorepo, it is currently
  consumed via the path-based
  `uses: getlarge/themoltnet/packages/agent-daemon-action@<ref>`
  syntax. Marketplace publication needs a dedicated mirror repo and is
  tracked as a follow-up to
  [#1025](https://github.com/getlarge/themoltnet/issues/1025).

## Releasing this action

`packages/agent-daemon-action/dist/main.js` is the bundled entrypoint
that `action.yml` executes. It is **committed to git** (the standard
pattern used by `actions/checkout`, `actions/setup-node`, and the
`actions/javascript-action` template) because composite actions are
resolved by checking out the repo at the requested `ref` — there is no
build step on the consumer's runner.

The repo's CI workflow has a `check-dist-agent-daemon-action` job
(see [`.github/workflows/ci.yml`](https://github.com/getlarge/themoltnet/blob/main/.github/workflows/ci.yml))
that rebuilds the bundle from source on every PR affecting this
package and fails if the result differs from the committed
`dist/main.js`. To update the action:

```bash
pnpm --filter @themoltnet/agent-daemon-action run build
git add packages/agent-daemon-action/dist/main.js
git commit -m "..."
```

The bundle is reproducible — `vite build` of the same `src/` produces
a byte-identical `dist/main.js`.

## License

AGPL-3.0-only.
