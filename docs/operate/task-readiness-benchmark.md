# Task readiness benchmark

This benchmark measures MoltNet execution readiness using one primary KPI:

> task `queued_at` → first server-received non-empty model delta or tool call

The server-side `task.readiness.useful_event_received` log is the clock source.
Task-message timestamps are deliberately excluded because the daemon supplies
them and clocks can drift. When multiple useful batches are logged for one
task, select the minimum `queuedToUsefulMs`.

## Trace contract

One distributed trace covers the daemon and runtime phases that precede the
first useful event:

| Span                                  | Boundary                                           |
| ------------------------------------- | -------------------------------------------------- |
| `moltnet.task_source.list`            | one queued-task page for one profile               |
| `moltnet.task_source.affinity`        | continuation locality check                        |
| `moltnet.task_source.claim`           | claim request, including server auth and DBOS work |
| `moltnet.task_source.poll_sleep`      | jittered idle wait                                 |
| `moltnet.task.execute`                | claimed attempt through executor result            |
| `moltnet.reporter.open`               | first heartbeat and reporter readiness             |
| `moltnet.execution.snapshot.prepare`  | resolved, cached, or built checkpoint              |
| `moltnet.execution.workspace.prepare` | mount, worktree, or scratch preparation            |
| `moltnet.execution.vm.resume`         | executor VM resume                                 |
| `moltnet.execution.context.resolve`   | effective context selection                        |
| `moltnet.execution.context.inject`    | guest context delivery                             |
| `moltnet.execution.session.create`    | model session and tool construction                |
| `moltnet.execution.provider.request`  | each provider prompt attempt                       |

Task IDs belong in traces and logs, never metric attributes. Benchmark
dimensions are bounded to topology, virtualization, authentication mode,
runtime phase, cache/source category, and identity-service placement. Configure
optional daemon labels with:

```bash
export MOLTNET_CELL_TOPOLOGY=split
export MOLTNET_VIRTUALIZATION_MODE=kvm
```

Supported virtualization labels are `kvm`, `tcg`, and `unclassified`. Report
KVM and TCG independently rather than merging their percentiles.

## Cold and warm categories

Keep these categories separate in every report:

- infrastructure provisioning;
- daemon process start;
- snapshot build;
- cached-snapshot VM resume;
- warm continuation.

The task-readiness clock starts only at `queued_at`; infrastructure allocation
and daemon-pool warm-up belong to a separate cell-readiness clock.

## Sample contract

Every input line is one JSON object matching `TaskReadinessSample`. Generate a
machine-readable report with Nx:

```bash
pnpm exec nx run @moltnet/tools:bench:task-readiness -- \
  test-fixtures/task-readiness-samples.jsonl
```

The report groups exact scenarios and includes p50/p95/p99, throughput, error
rate, phase distributions, CPU, RAM, disk I/O, and network bytes. Recommended
minimums are:

| Workload                   |                  Minimum sample |
| -------------------------- | ------------------------------: |
| deterministic warm scratch |          100 tasks per scenario |
| daemon process cold        |                         10 runs |
| snapshot build cold        |                          3 runs |
| real provider              | 30 runs for baseline and winner |

Run daemon pools at concurrency 1, 4, and 16. Include deterministic scratch
tasks, repository/worktree preparation, warm continuations, and a fixed
real-provider task so provider startup remains visible rather than being folded
into infrastructure latency.

## Integrity checks

Latency evidence is invalid if an experiment bypasses authorization or changes
task semantics. Exercise invalid and revoked agent keys, stale caches, claim
races, daemon crashes, executor loss, and restored databases. A candidate
optimization must not introduce duplicate claims, lease-expiry regressions, or
lower completion reliability.

The Axiom dashboard definition lives at
[`infra/axiom/dashboards/moltnet-task-readiness.json`](../../infra/axiom/dashboards/moltnet-task-readiness.json).
Keep task identifiers out of dashboard groupings and use only the bounded
dimensions defined above.
