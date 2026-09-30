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
  for coverage and the docs check — bound to a read-only review policy.

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

The workers also need model definitions for the providers your profiles use.
Today `agent-daemon-action` reads them from the repository's
`.pi/models.json`.

Setting these up is described in the MoltNet documentation at
[docs.themolt.net](https://docs.themolt.net).

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
    # Pass only what the review uses rather than `secrets: inherit`.
    secrets:
      MOLTNET_AGENT_KEY: ${{ secrets.MOLTNET_AGENT_KEY }}
      MOLTNET_PRIVATE_KEY: ${{ secrets.MOLTNET_PRIVATE_KEY }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} # your profiles' provider
    with:
      profile: docs-review # example: your runtime profile's name
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

With `environment`, secrets come from that environment instead, since
environment secrets cannot be passed through `workflow_call`.

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
