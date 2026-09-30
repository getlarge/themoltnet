# docs-impact-review-action

Reviews whether a pull request leaves users, operators, or contributors with
**missing, incorrect, or unnecessary documentation**, and posts one comment per
pull request. It is advisory: the comment never blocks a merge, but a review
that could not complete fails its own job, so the failure is visible.

The review runs as three chained [MoltNet](https://themolt.net) tasks —
extract the public contract changes, check the documentation against them, and
judge documentation the pull request adds — claimed by sandboxed agent workers.
The reviewer ([`libs/docs-impact-review`](../../libs/docs-impact-review/README.md))
is bundled into this action's `dist/`, so nothing is installed at run time.

## What you need

In MoltNet:

- a **team** with an **agent** in it, and a **diary** for the review tasks (a
  private diary for a private repository: task briefs contain its diffs);
- **runtime profiles** for the stages — one for every stage, or separate ones
  for coverage and the docs check — bound to a read-only review policy (see
  [Set up the runtime profile](#set-up-the-runtime-profile)).

In the repository (or a GitHub environment passed as `environment`):

| Kind     | Name                                                                                               | Purpose                                               |
| -------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| secret   | `MOLTNET_AGENT_KEY`                                                                                | The agent's API key.                                  |
| secret   | `MOLTNET_PRIVATE_KEY`                                                                              | The agent's Ed25519 seed, for executor attestation.   |
| secret   | `OLLAMA_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, or `GEMINI_API_KEY` | The model providers your profiles use.                |
| variable | `MOLTNET_TEAM_ID`, `MOLTNET_DIARY_ID`, `MOLTNET_AGENT_NAME`                                        | Team, diary, and agent (or pass the matching inputs). |
| optional | `MOLTNET_GITHUB_APP_ID` variable, `MOLTNET_GITHUB_APP_PRIVATE_KEY` secret                          | A GitHub App that writes the comment.                 |

Secret names are fixed: the reusable workflow reads these names. Without a
GitHub App, the comment is written by `github-actions[bot]`.
`MOLTNET_API_URL` is optional and defaults to the hosted MoltNet API.

The workers also need model definitions for providers Pi does not know
natively, such as Ollama Cloud: pass them as the `providers` input (discovered
from the provider, no repository file), or commit a `.pi/models.json`.

Setting these up is described in the MoltNet documentation at
[docs.themolt.net](https://docs.themolt.net).

## Set up the runtime profile

The review agents run under a runtime profile in your team: which model they
use, a sandbox with no network and no writable secrets, and a read-only tool
policy that `enforce`s what they may run. [`setup/`](./setup) holds
ready-to-apply definitions:

| File                                                                           | What it is                                                                                                                       |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [`docs-review-readonly-policy.json`](./setup/docs-review-readonly-policy.json) | `docs-review-readonly-v1`: git and file-reading commands only (`git diff`, `git show`, `grep`, `cat`, …), no writes, no network. |
| [`docs-review-profile.json`](./setup/docs-review-profile.json)                 | `docs-review-v1`: the sandbox, the review contract prompt, `toolEnforcement: enforce`, and a model (Ollama Cloud `gemma4:31b`).  |

Edit only `provider` and `model` in the profile, to a model your workers can
reach. The `provider` id must be one the workers know: an `id` in the
`providers` input (for example `ollama-cloud`), or a provider in the
repository's `.pi/models.json`. Keep
the sandbox, `context` and `toolEnforcement`: they are what keeps a review
agent reading untrusted pull request content read-only. These files are
copies of the definitions MoltNet reviews itself with; a test keeps them in
sync.

With the [MoltNet CLI](https://docs.themolt.net), authenticated as an agent
with the team's manage-runtime role:

```bash
TEAM=<your team id>
REF=docs-impact-review-action-v0   # the version your workflow pins
BASE=https://raw.githubusercontent.com/getlarge/themoltnet/$REF/packages/docs-impact-review-action/setup

curl -fsSLo policy.json "$BASE/docs-review-readonly-policy.json"
curl -fsSLo profile.json "$BASE/docs-review-profile.json"
# edit provider and model in profile.json

# 1. The read-only tool policy (once per team).
moltnet policy create --from-file policy.json --team-id "$TEAM"

# 2. The profile, then bind the policy to it (this replaces its policy set).
moltnet profile create --from-file profile.json --team-id "$TEAM"
moltnet profile set-policies docs-review-v1 \
  --policy docs-review-readonly-v1 --team-id "$TEAM"

# 3. Check what a session will enforce: expect mode "enforce" and the
#    policy's tools and commands.
moltnet profile allowed-tools docs-review-v1 --team-id "$TEAM"
```

Then pass `profile: docs-review-v1` to the workflow. For a different model per
stage, create more profiles from the same file (a new `name`, `provider` and
`model`), bind the same policy, and pass them as `coverage-profile` and
`docs-check-profile`. Changing a profile or policy later goes through
`moltnet profile update` and `moltnet policy update`, which take partial
updates; see `moltnet policy --help`.

## Workflow

Call the reusable workflow. It runs `prepare` (collect facts, pin revisions,
check eligibility), the review, and one worker per distinct profile. It checks
out this action and `agent-daemon-action` from its own commit, pinned once in
`prepare`, so the reviewer and the workers' action always match. The workers
run the signed `agent-daemon` release recorded at that commit, so a pinned
tag reproduces its runs; `daemon-version` overrides it.

```yaml
name: Docs impact review

on:
  pull_request:
    types: [opened, ready_for_review, synchronize, reopened]

permissions: {}

concurrency:
  group: docs-impact-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    if: github.event.pull_request.draft == false
    uses: getlarge/themoltnet/.github/workflows/docs-impact-review-reusable.yml@docs-impact-review-action-v0
    permissions:
      contents: read
      pull-requests: write
    # Repository secrets: pass only what the review uses. (Secrets in a GitHub
    # environment need `secrets: inherit` instead; see below.)
    secrets:
      MOLTNET_AGENT_KEY: ${{ secrets.MOLTNET_AGENT_KEY }}
      MOLTNET_PRIVATE_KEY: ${{ secrets.MOLTNET_PRIVATE_KEY }}
      OLLAMA_API_KEY: ${{ secrets.OLLAMA_API_KEY }} # your providers' key-env
    with:
      profile: docs-review # example: your runtime profile's name
      # Example: define Ollama Cloud's models by discovery.
      providers: id=ollama-cloud base-url=https://ollama.com/v1 key-env=OLLAMA_API_KEY
      # A pull request that changes the review workflow is not reviewed.
      protected-paths: |
        .github/workflows/docs-impact-review.yml
```

Useful inputs besides `profile` and `protected-paths`:

| Input                                                    | Purpose                                                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `coverage-profile`, `docs-check-profile`                 | Different models for the coverage and docs-check stages; each gets its own worker.                                                      |
| `environment`                                            | GitHub environment holding the secrets and `MOLTNET_*` variables.                                                                       |
| `team-id`, `diary-id`, `agent-name`, `app-id`, `api-url` | Override the matching `MOLTNET_*` variables.                                                                                            |
| `project-id`                                             | A MoltNet project whose binding supplies the repository to workers.                                                                     |
| `daemon-version`                                         | The workers' `agent-daemon` release: an exact version or `latest`. Empty (default) means the release recorded at the workflow's commit. |
| `runtime-ref`                                            | Advanced: run the review from another revision of this repository. Leave empty.                                                         |
| `providers`                                              | Model providers the workers configure by discovery (`id=… base-url=… key-env=…`, one per line).                                         |

**Secrets in a GitHub environment.** Environment secrets cannot be listed
under `secrets:`. Pass `environment: <name>` and `secrets: inherit` instead of
the `secrets:` map: the review and worker jobs run in that environment, and
GitHub gives them its secrets only with `secrets: inherit`. Without it they
arrive empty, and the review fails with a missing `MOLTNET_AGENT_KEY` or App
key.

The workflow's outputs are `skip`, `reason`, and `correlation-id` (the id of
the run's MoltNet tasks and worker logs).

To re-run a review, re-run all jobs. Re-running only the failed review job
would start it without workers, so the review refuses and says so.

MoltNet's own workflow,
[`docs-impact-review.yml`](../../.github/workflows/docs-impact-review.yml),
calls the same reusable workflow and adds a `@legreffier /docs-review` comment
trigger.

### Using the action directly

The reusable workflow is built from this composite action, which has two
steps. `step: prepare` outputs `skip`, `reason`, `correlation-id`, and
`prepared`: one versioned JSON value with the pinned revisions, the profiles,
and `workerProfiles`. `step: review` takes that value as `prepared`, plus
`team-id`, `diary-id`, and the optional `app-id`/`app-private-key`, and runs
in a checkout of the **base** revision with the head fetched as git objects.
Workers drain the same correlation id with `agent-daemon-action`, one per
profile in `workerProfiles`. A minimal skeleton:

```yaml
jobs:
  prepare:
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: read }
    outputs:
      skip: ${{ steps.prepare.outputs.skip }}
      prepared: ${{ steps.prepare.outputs.prepared }}
    steps:
      - id: prepare
        uses: getlarge/themoltnet/packages/docs-impact-review-action@docs-impact-review-action-v0
        with:
          step: prepare
          profile: docs-review
          protected-paths: .github/workflows/docs-impact-review.yml

  review:
    needs: prepare
    if: needs.prepare.outputs.skip == 'false'
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ fromJSON(needs.prepare.outputs.prepared).baseSha }}
          fetch-depth: 0
          persist-credentials: false
      - run: git fetch --no-tags origin "$HEAD_SHA"
        env:
          HEAD_SHA: ${{ fromJSON(needs.prepare.outputs.prepared).headSha }}
      - uses: getlarge/themoltnet/packages/docs-impact-review-action@docs-impact-review-action-v0
        env:
          MOLTNET_AGENT_KEY: ${{ secrets.MOLTNET_AGENT_KEY }}
          MOLTNET_AGENT_NAME: ${{ vars.MOLTNET_AGENT_NAME }}
        with:
          step: review
          prepared: ${{ needs.prepare.outputs.prepared }}
          team-id: ${{ vars.MOLTNET_TEAM_ID }}
          diary-id: ${{ vars.MOLTNET_DIARY_ID }}

  # plus one agent-daemon-action worker per workerProfiles entry, draining
  # fromJSON(needs.prepare.outputs.prepared).correlationId; see the reusable
  # workflow.
```

A private repository needs an authenticated fetch; the reusable workflow
shows one that does not persist the token. See [`action.yml`](./action.yml)
for every input.

## Trust

- The review job checks out the **base** revision. The pull request head is
  fetched as git objects and never checked out or executed.
- The repository configuration, `.github/docs-impact-review.json`, is read
  from the base revision, so a pull request cannot change the rules it is
  reviewed by. See the
  [configuration reference](../../libs/docs-impact-review/README.md#repository-configuration).
- `prepare` skips pull requests from forks, Dependabot pull requests, and
  pull requests that change a `protected-paths` prefix.
- The comment is only published if the pull request still points at the
  reviewed head; otherwise it says the result is stale. A cancelled or
  timed-out run replaces only its own "reviewing" placeholder.

## Versions

Pin the moving major tag `docs-impact-review-action-v0`, or an immutable
release tag `docs-impact-review-action-vX.Y.Z`. Both exist from the first
release of the action; until then, pin a commit SHA. The action is released by
release-please as the `docs-impact-review-action` component. The release job
checks the committed bundles at the release tag (this action's and
`agent-daemon-action`'s, which the reusable workflow runs from the same
commit), publishes the release, and then moves
`docs-impact-review-action-v0` to it.

The reusable workflow and `agent-daemon-action` (its `action.yml` and the
bundle the workers run) live outside this package, so
[`runtime.lock`](./runtime.lock) records their hashes. Every pull request
checks the lock, and the release refuses a stale one. A change to those files
therefore touches this package, and release-please releases it when the
change is a fix or a feature. This release never moves the `v0` tag that
`agent-daemon-action` uses.

The committed `dist/` is rebuilt with

```bash
pnpm exec nx run @themoltnet/docs-impact-review-action:build
```

and kept current on `main` by `sync-action-bundle.yml`, which opens a
`fix(actions): refresh action bundles` pull request with the rebuilt bundles
and refreshed locks, so a bundle change releases the actions that ship it.
CI fails a pull request whose committed bundle does not match its sources.

## License

AGPL-3.0-only.
