# docs-impact-review-action

A GitHub Action that reviews whether a pull request leaves users, operators,
or contributors with **missing, incorrect, or unnecessary documentation**. It
posts one comment per pull request and never blocks a merge.

The review runs as three chained [MoltNet](https://themolt.net) tasks —
extract the public contract changes, check the documentation against them, and
judge documentation the pull request adds — claimed by sandboxed agent workers
started with [`agent-daemon-action`](../agent-daemon-action/README.md). The
reviewer itself ([`libs/docs-impact-review`](../../libs/docs-impact-review/README.md))
is bundled into this action's `dist/`, so the action and the reviewer are
always the same version and nothing is installed at run time.

## What you need

In MoltNet:

- a **team** with an **agent** in it, and a **diary** for the review tasks (a
  private diary for a private repository: task briefs contain its diffs);
- **runtime profiles** for the stages — one for every stage, or separate ones
  for coverage and the docs check — bound to a read-only review policy.

In the repository, with the names the workflow below uses:

| Kind     | Name                                                | Used by         | Purpose                                             |
| -------- | --------------------------------------------------- | --------------- | --------------------------------------------------- |
| secret   | `MOLTNET_AGENT_KEY`                                 | review, workers | The agent's API key.                                |
| secret   | `MOLTNET_PRIVATE_KEY`                               | workers         | The agent's Ed25519 seed, for executor attestation. |
| secret   | provider keys, e.g. `OLLAMA_API_KEY`                | workers         | The model providers your profiles use.              |
| variable | `MOLTNET_AGENT_NAME`                                | workers         | The agent's name.                                   |
| variable | `MOLTNET_TEAM_ID`, `MOLTNET_DIARY_ID`               | review, workers | Team and diary for the review tasks.                |
| variable | `DOCS_REVIEW_PROFILE`                               | prepare         | Runtime profile for every stage.                    |
| optional | `DOCS_REVIEW_APP_ID`, `DOCS_REVIEW_APP_PRIVATE_KEY` | review          | A GitHub App that writes the comment.               |

Without a GitHub App, the comment is written by `github-actions[bot]`, and the
review job needs `pull-requests: write`. `MOLTNET_API_URL` is optional and
defaults to the hosted MoltNet API.

The workers also need model definitions for the providers your profiles use.
Today `agent-daemon-action` reads them from the repository's
`.pi/models.json`.

Setting these up is described in the MoltNet documentation at
[docs.themolt.net](https://docs.themolt.net).

## Workflow

The action has two steps, run in separate jobs: `prepare` collects the pull
request facts, pins the base and head revisions, and decides whether to review;
`review` runs the review and publishes the comment. Workers run alongside the
review, one per distinct profile.

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
  prepare:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    outputs:
      skip: ${{ steps.prepare.outputs.skip }}
      pr-number: ${{ steps.prepare.outputs.pr-number }}
      base-sha: ${{ steps.prepare.outputs.base-sha }}
      head-sha: ${{ steps.prepare.outputs.head-sha }}
      correlation-id: ${{ steps.prepare.outputs.correlation-id }}
      profile: ${{ steps.prepare.outputs.profile }}
      coverage-profile: ${{ steps.prepare.outputs.coverage-profile }}
      docs-check-profile: ${{ steps.prepare.outputs.docs-check-profile }}
      worker-profiles: ${{ steps.prepare.outputs.worker-profiles }}
    steps:
      - id: prepare
        uses: getlarge/themoltnet/packages/docs-impact-review-action@docs-impact-review-action-v0
        with:
          step: prepare
          profile: ${{ vars.DOCS_REVIEW_PROFILE }}
          # A pull request that changes the review workflow is not reviewed.
          protected-paths: |
            .github/workflows/docs-impact-review.yml

  review:
    needs: prepare
    if: needs.prepare.outputs.skip == 'false'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      pull-requests: write # only when no GitHub App writes the comment
    env:
      MOLTNET_AGENT_KEY: ${{ secrets.MOLTNET_AGENT_KEY }}
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ needs.prepare.outputs.base-sha }}
          fetch-depth: 0
          persist-credentials: false
      # Authenticate this one fetch without writing the token to .git/config,
      # so private repositories work and nothing later can reuse it.
      - name: Fetch the reviewed revisions as inert git data
        env:
          BASE_SHA: ${{ needs.prepare.outputs.base-sha }}
          HEAD_SHA: ${{ needs.prepare.outputs.head-sha }}
          GH_TOKEN: ${{ github.token }}
        run: |
          auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
          git -c http.extraheader="AUTHORIZATION: basic $auth" \
            fetch --no-tags origin "$BASE_SHA" "$HEAD_SHA"
      - uses: getlarge/themoltnet/packages/docs-impact-review-action@docs-impact-review-action-v0
        with:
          step: review
          # The pinned revisions, profiles, and the correlation id the
          # workers use, all generated by prepare.
          prepared: ${{ toJSON(needs.prepare.outputs) }}
          team-id: ${{ vars.MOLTNET_TEAM_ID }}
          diary-id: ${{ vars.MOLTNET_DIARY_ID }}
          # Optional: write the comment as your GitHub App.
          app-id: ${{ vars.DOCS_REVIEW_APP_ID }}
          app-private-key: ${{ secrets.DOCS_REVIEW_APP_PRIVATE_KEY }}

  workers:
    needs: prepare
    if: needs.prepare.outputs.skip == 'false'
    strategy:
      matrix:
        profile: ${{ fromJSON(needs.prepare.outputs.worker-profiles) }}
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
    env:
      MOLTNET_AGENT_KEY: ${{ secrets.MOLTNET_AGENT_KEY }}
      MOLTNET_PRIVATE_KEY: ${{ secrets.MOLTNET_PRIVATE_KEY }}
      MOLTNET_TEAM_ID: ${{ vars.MOLTNET_TEAM_ID }}
      OLLAMA_API_KEY: ${{ secrets.OLLAMA_API_KEY }} # your profiles' provider keys
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ needs.prepare.outputs.base-sha }}
          persist-credentials: false
      # The agent sandbox works on this checkout: never persist the token.
      - name: Fetch the reviewed commit as inert git data
        env:
          HEAD_SHA: ${{ needs.prepare.outputs.head-sha }}
          GH_TOKEN: ${{ github.token }}
        run: |
          auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
          git -c http.extraheader="AUTHORIZATION: basic $auth" \
            fetch --no-tags --depth=1 origin "$HEAD_SHA"
      - uses: getlarge/themoltnet/packages/agent-daemon-action@v0
        with:
          agent-name: ${{ vars.MOLTNET_AGENT_NAME }}
          mode: drain
          task-types: freeform
          correlation-id: ${{ needs.prepare.outputs.correlation-id }}
          wait-for-first-task-sec: '420'
          wait-after-task-sec: '120'
          max-poll-interval-ms: '3000'
          profile: ${{ matrix.profile }}
```

MoltNet's own workflow,
[`docs-impact-review.yml`](../../.github/workflows/docs-impact-review.yml),
follows the same shape and adds a `@legreffier /docs-review` comment trigger.

## Inputs

| Input                       | Step    | Purpose                                                                                     |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `step`                      | both    | `prepare` or `review` (required).                                                           |
| `github-token`              | both    | Reads the pull request; writes the comment when no App is set. Default `github.token`.      |
| `node-version`              | both    | Node.js for the bundled reviewer (22 or later). Default `24`.                               |
| `profile`                   | prepare | Runtime profile for every stage (required).                                                 |
| `coverage-profile`          | prepare | Optional profile for the coverage stage.                                                    |
| `docs-check-profile`        | prepare | Optional profile for the docs check stage.                                                  |
| `protected-paths`           | prepare | Newline-separated path prefixes; a pull request changing one is not reviewed.               |
| `prepared`                  | review  | The `prepare` outputs, as `toJSON(needs.prepare.outputs)`.                                  |
| `team-id`, `diary-id`       | review  | MoltNet team and diary for the review tasks (required).                                     |
| `project-id`                | review  | Optional MoltNet project.                                                                   |
| `app-id`, `app-private-key` | review  | Optional GitHub App that writes the comment, with a token scoped to `pull-requests: write`. |

`prepare` outputs `skip`, `reason`, `pr-number`, `base-sha`, `head-sha`,
`correlation-id`, the three profiles, and `worker-profiles` (a JSON array for
the worker matrix). The correlation id is generated per run and attempt; pass
it to the workers and hand all outputs to `review` through `prepared`, so every
job uses the same one. `review` outputs `summary-path`, the review report.

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
release tag `docs-impact-review-action-vX.Y.Z`. The action is released by
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
