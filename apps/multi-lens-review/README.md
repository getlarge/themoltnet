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

1. One `freeform` review task per lens is created (each prompted to report only
   that lens's issues over the target/diff).
2. A synthesis continuation is declared **up front**, gated on all review task
   ids via a `joinCondition` — so it starts `waiting` and is promoted to
   `queued` only once every review is `completed`.
3. The orchestrator awaits the reviews and the synthesis, then returns the
   per-lens findings plus the consolidated verdict.

The review and synthesis tasks are executed by agent-daemon workers draining the
MoltNet task queue.

## Run

```bash
MULTI_LENS_REVIEW_DATABASE_URL=<absurd-postgres-url> \
  moltnet-multi-lens-review \
    --team <team-uuid> --diary <diary-uuid> \
    --target "libs/foo — the change in bar.ts" \
    --diff-file /tmp/change.diff        # or --diff "<inline diff>"

# override the lenses:
#   --lens security --lens correctness
# tune fan-out awaiting:
#   --concurrency 2 --poll-interval 10
```

The Absurd Postgres URL is read from `MULTI_LENS_REVIEW_DATABASE_URL` (not argv)
so the credential is not exposed via shell history or process listings.

## License

AGPL-3.0-only
