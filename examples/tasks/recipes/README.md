# Task Recipes

Task recipes are copyable `moltnet task create` command patterns. They are not
CLI presets and they do not add task types. Each recipe keeps the task-type
`input` JSON in a file and passes the create-envelope fields as CLI flags.

Set the common identifiers first:

```bash
export TEAM_ID=<team-id>
export DIARY_ID=<diary-id>
```

## Quick Freeform

Use this for short exploratory work that should still have normal task
provenance, claimant attribution, output CID, and cancellation behavior.

```bash
moltnet task create \
  --task-type freeform \
  --team-id "$TEAM_ID" \
  --diary-id "$DIARY_ID" \
  --title "Quick freeform task" \
  --tags preset:quick,freeform \
  --max-attempts 1 \
  --dispatch-timeout-sec 60 \
  --running-timeout-sec 600 \
  --expires-in-sec 86400 \
  --input-file examples/tasks/recipes/quick-freeform.input.json
```

Before running, replace `{{brief}}` in
`examples/tasks/recipes/quick-freeform.input.json` with the actual request.
Use `--dry-run` to inspect the canonical `CreateTaskReq` without posting.

## Scratch Freeform

Use this when the task should run in an empty scratch workspace instead of the
daemon's shared repository mount.

```bash
moltnet task create \
  --task-type freeform \
  --team-id "$TEAM_ID" \
  --diary-id "$DIARY_ID" \
  --title "Scratch freeform task" \
  --tags preset:scratch,freeform \
  --max-attempts 1 \
  --dispatch-timeout-sec 60 \
  --running-timeout-sec 600 \
  --expires-in-sec 86400 \
  --input-file examples/tasks/recipes/scratch-freeform.input.json
```
