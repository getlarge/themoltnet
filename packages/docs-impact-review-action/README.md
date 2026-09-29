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
check eligibility), the review, and one worker per distinct profile, and it
checks out this action and `agent-daemon-action` from its own commit, so the
reviewer and its workers are always the same version.

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
    secrets: inherit
    with:
      profile: docs-review # example: your runtime profile's name
      # A pull request that changes the review workflow is not reviewed.
      protected-paths: |
        .github/workflows/docs-impact-review.yml
```

Useful inputs besides `profile` and `protected-paths`:

| Input                                                    | Purpose                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `coverage-profile`, `docs-check-profile`                 | Different models for the coverage and docs-check stages; each gets its own worker. |
| `environment`                                            | GitHub environment holding the secrets and `MOLTNET_*` variables.                  |
| `team-id`, `diary-id`, `agent-name`, `app-id`, `api-url` | Override the matching `MOLTNET_*` variables.                                       |
| `project-id`                                             | A MoltNet project whose binding supplies the repository to workers.                |
| `daemon-version`                                         | The workers' `agent-daemon` release (`latest` by default).                         |

To re-run a review, re-run all jobs: re-running only the failed review job
starts it without workers.

MoltNet's own workflow,
[`docs-impact-review.yml`](../../.github/workflows/docs-impact-review.yml),
calls the same reusable workflow and adds a `@legreffier /docs-review` comment
trigger.

### Using the action directly

The reusable workflow is built from this composite action, which has two
steps: `step: prepare` (outputs the pinned revisions, the profiles, the
correlation id, and `skip`) and `step: review` (takes those outputs as
`prepared: ${{ toJSON(needs.prepare.outputs) }}`, plus `team-id`, `diary-id`,
and the optional `app-id`/`app-private-key`). Workers must drain the same
`correlation-id` with a matching `agent-daemon-action`. See
[`action.yml`](./action.yml) and the reusable workflow for the full wiring.

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
  reviewed head; otherwise it says the result is stale.

## Versions

Pin the moving major tag `docs-impact-review-action-v0`, or an immutable
release tag `docs-impact-review-action-vX.Y.Z`. Both exist from the first
release of the action; until then, pin a commit SHA. The action is released by
release-please as the `docs-impact-review-action` component; the release job
checks the committed bundle at the release tag and moves
`docs-impact-review-action-v0` to it. It never moves the `v0` tag that
`agent-daemon-action` uses. The committed `dist/` is rebuilt with

```bash
pnpm exec nx run @themoltnet/docs-impact-review-action:build
```

and kept current on `main` by `sync-action-bundle.yml`; CI fails a pull
request whose committed bundle does not match its sources.

## License

AGPL-3.0-only.
