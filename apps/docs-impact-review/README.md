# @moltnet/docs-impact-review

Experimental documentation-impact reviewer for pull requests
([#2373](https://github.com/getlarge/themoltnet/issues/2373)). It answers one
question: **does this PR leave users, operators, or contributors with missing
or incorrect instructions?** It is not a correctness, security, style, or
general docs review.

This app is the measurement harness. It runs locally against existing PRs so
precision and per-phase latency can be measured before any CI workflow or PR
comment exists.

## Pipeline

```text
trusted ingest (git, base .gitattributes)      no model
  │  source/docs patches only; tests, generated, binary listed by name
  │  deleted files summarized by header; every dropped file is a gap
  ├─ no source and no docs changed ───────────▶ not-needed (0 tasks)
  ▼
stage 1: extract   freeform task, workspace none, tool-less
  │  public contract changes + evidence + exact search terms
  ├─ no contract change and no docs changed ──▶ not-needed (1 task)
  ▼
trusted retrieval                              no model
  │  docs changed in PR > routing map > symbol search > nearest README
  │  at most 6 docs, heading-bounded excerpts at head
  ▼
stage 2: coverage  freeform task, dedicated worktree at head, ≤4 reads
  │  covered | updates-needed | not-needed, ≤3 findings
  ▼
trusted resolution
     any gap + clean outcome ▶ incomplete; stage failure ▶ failed (no outcome)
```

Trusted code validates both stage outputs strictly: evidence must cite changed
files, findings must reference a known change (or `docs:<changed doc>` for a
contradiction in a doc the PR edits), and `incomplete` can only be decided by
trusted code, never by the model.

## Budgets

| Budget                      | Default  | Where                       |
| --------------------------- | -------- | --------------------------- |
| Diff bytes (stage 1)        | 64 000   | `DEFAULT_BUDGETS`           |
| Per-file patch bytes        | 12 000   | `DEFAULT_BUDGETS`           |
| Docs-diff bytes (stage 2)   | 16 000   | `DEFAULT_BUDGETS`           |
| Excerpt bytes per doc       | 8 000    | `DEFAULT_BUDGETS`           |
| Docs per review             | 6        | `DEFAULT_BUDGETS`           |
| Running timeout per stage   | 90 s     | `STAGE_RUNNING_TIMEOUT_SEC` |
| Model turns / output tokens | 6 / 4096 | runtime profile             |

Byte budgets target ~24k input tokens per stage. Output tokens start above the
issue's 1.5k target because reasoning tokens count against the limit; tune it
from measured `outputTokens`.

## Timing

Every stage records server timestamps plus transcript markers, so poll delay
never skews the split:

| Field               | Span                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- |
| `queueMs`           | task created → claimed                                                             |
| `openMs`            | claimed → first heartbeat (`startedAt`)                                            |
| `setupMs`           | first heartbeat → `execute_start`: snapshot, worktree, VM resume, guest projection |
| `firstModelEventMs` | `execute_start` → first model text or tool call                                    |
| `modelMs`           | first model event → completed                                                      |
| `observedMs`        | client-observed create → terminal, including poll delay                            |

Polling defaults to 0.5 s (`--poll-interval`). The corpus summary prints
p50/p95 for each phase, plus ingest, retrieval, and total wall time.

## Run against existing PRs

Run from a checkout of the reviewed repository with `gh` authenticated.

Ingestion and routing only, no tasks:

```bash
pnpm exec nx run @moltnet/docs-impact-review:cli -- \
  --repo getlarge/themoltnet --pr 2462 --pr 2464 --dry-run
```

Full review, which needs the runtime profile and a daemon claiming it:

```bash
# once per team (operator action)
moltnet profile create \
  --from-file .github/runtime-profiles/legreffier-docs-review-v1.json \
  --team-id "$MOLTNET_TEAM_ID"

# terminal 1: a daemon that claims the review stages
moltnet-agent poll --agent "$MOLTNET_AGENT_NAME" --team "$MOLTNET_TEAM_ID" \
  --profile legreffier-docs-review-v1 --task-types freeform

# terminal 2: review a corpus, write per-PR reports
pnpm exec nx run @moltnet/docs-impact-review:cli -- \
  --repo getlarge/themoltnet --pr 2462 --pr 2454 --pr 2459 \
  --team "$MOLTNET_TEAM_ID" --diary "$MOLTNET_DIARY_ID" \
  --profile legreffier-docs-review-v1 --out /tmp/docs-impact
```

Each stage task is tagged `review:docs-impact`, `stage:<extract|coverage>`,
`pr:<n>`, and `revision:<head>`, and shares one correlation id per PR.

## Routing map

[`docs-routing.json`](./docs-routing.json) maps cross-cutting code paths to
canonical pages. Package-level READMEs are found by the nearest-README rule, so
the map only lists pages a README would miss. A test fails when a mapped doc
no longer exists.
