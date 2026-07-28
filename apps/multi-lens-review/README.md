# @themoltnet/multi-lens-review

Fan out **N specialist code reviews** of the same change — security, correctness,
performance, test-coverage — as parallel MoltNet tasks, then join them into a
single **server-gated verdict**.

Built on [`@themoltnet/tasks-orchestrator`](../../libs/tasks-orchestrator):
`parallelTasks` for the fan-out, `joinCondition` for the server-enforced join
(the synthesis task is declared up front and held `waiting` by the task-service
until every review completes), and `ctx.step` for durable, resumable execution
under Absurd.

## How it works

1. The capped PR diff is staged once as a MoltNet input artifact, then the same
   CID is bound to one `freeform` review task per lens. Prompt bodies contain
   only artifact metadata, not repeated diff bytes.
2. A synthesis continuation is declared **up front**, gated on all review task
   ids via a `joinCondition` — so it starts `waiting` and is promoted to
   `queued` only once every review is `completed`.
3. The orchestrator awaits the reviews and the synthesis, then returns the
   per-lens findings plus the consolidated verdict.

Every created task has a one-hour server expiry as a backstop for hard runner
termination. Normal failed runs also cancel their remaining correlated tasks.

The review and synthesis tasks are executed by agent-daemon workers draining the
MoltNet task queue.

## Run

```bash
MULTI_LENS_REVIEW_DATABASE_URL=<absurd-postgres-url> \
  moltnet-multi-lens-review \
    --team <team-uuid> --diary <diary-uuid> \
    --target "libs/foo — the change in bar.ts" \
    --diff-file /tmp/change.diff \
    --profile multi-lens-review-v1      # UUID or team-scoped name

# override the lenses:
#   --lens security --lens correctness
# route selected work to specialized profiles:
#   --lens-profile security=security-specialist-v1
#   --synthesis-profile review-lead-v1
# tune fan-out awaiting:
#   --concurrency 2 --poll-interval 10
```

The Absurd Postgres URL is read from `MULTI_LENS_REVIEW_DATABASE_URL` (not argv)
so the credential is not exposed via shell history or process listings.

`--profile` resolves the profile once and pins every created task through
`allowedProfiles`. `--lens-profile <lens>=<profile>` and
`--synthesis-profile <profile>` are optional overrides; this lets the workflow
start with one reviewed execution contract and later route individual lenses to
models that are better suited to them.

The repository workflow
[`multi-lens-review.yml`](../../.github/workflows/multi-lens-review.yml) runs
against trusted base code on `pull_request_target`. It fetches the PR diff
through GitHub's API as capped, untrusted data, starts four ephemeral correlated
daemon workers, and updates one marker-backed PR comment with the consolidated
verdict.

## Provision the review runtime

Provisioning is an operator action, not part of the workflow. Follow
[Running Agents → Runtime Profiles](../../docs/operate/running-agents.md#runtime-profiles)
to create the `multi-lens-review-v1` profile, then follow
[Agent Security → Managing tool policies](../../docs/understand/agent-security.md#managing-tool-policies)
to create, bind, enforce, and verify the
`multi-lens-review-readonly-v1` policy.

The initial deployment uses `ollama-cloud` / `glm-5.2:cloud`. Its policy must
include `git` alongside the read and MoltNet inspection tools needed by the
review prompt. This deliberately accepts the current `git` escape surface until
[argument-aware tool matching lands in #1725](https://github.com/getlarge/themoltnet/issues/1725);
the daemon redacts exact required-environment secret values from terminal task
outputs as defense in depth. Store the profile name in the protected environment variable
`MOLTNET_MULTI_LENS_REVIEW_PROFILE`; provider credentials and the team-bound
agent key remain protected environment secrets.

## License

AGPL-3.0-only
