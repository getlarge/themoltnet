# Complexity review

This app owns the LeGreffier PR complexity review. The GitHub workflow pins a PR's
base and head, then runs trusted code from the base revision. The app reads the
immutable diff, creates one `freeform` task, waits for its accepted output, and
validates the binary rubric before the workflow publishes a revision-aware
comment with the LeGreffier GitHub App token.

The model receives a bounded evidence packet and has no optional tools. Diffs
over 96 KB fail visibly before a task is created; they are never silently scored
from a partial view. The task has one attempt and a 180-second running budget.
The CI review job and drain worker run in parallel under one correlation ID.

The source-controlled runtime assets are
[`legreffier-complexity-review-v2.json`](../../.github/runtime-profiles/legreffier-complexity-review-v2.json)
and
[`legreffier-complexity-review-input-only-v1.json`](../../.github/runtime-policies/legreffier-complexity-review-input-only-v1.json).
Their live team copies are managed through released `moltnet profile` and
`moltnet policy` commands. The profile uses GLM 5.3 Flash with four turns and
no shell, file, network, or diary tools.

For a read-only local ingestion trial:

```bash
node --import tsx apps/complexity-review/src/main.ts \
  --repo getlarge/themoltnet --pr 2545 \
  --base <base-oid> --head <head-oid> --dry-run
```

For a model trial, start a MoltNet daemon worker bound to this checkout with
profile `legreffier-complexity-review-v2` and task type `freeform`, then add
`--team`, `--diary`, `--profile`, and `--correlation` to the command above.
The app prints `{ taskId, output, durationMs, base, head, pr }` as JSON.
