# Keto task-claim benchmark

Use the `@moltnet/tools:bench:keto-claim` Nx target to compare the executor
transition OPL with the final OPL against identical, deterministic fixtures.
Run two local Keto instances backed by the same disposable Postgres fixture
database so the OPL revision is the only authorization variable: baseline
read/write on `127.0.0.1:4466/4467`, candidate on
`127.0.0.1:4566/4567`. Load
`infra/ory/permissions.executor-transition.ts` into the baseline and
`infra/ory/permissions.ts` into the candidate.

```bash
pnpm exec nx run @moltnet/tools:bench:keto-claim
```

Defaults are 100 teams, 100 identities per team, and 100 tasks per team. Each
owner, manager, executor, member, task-writer, task-manager, and denied
scenario runs five rounds of 1,000 checks at concurrency 1 and 32. The command
prints JSON containing p50, p95, p99, mean, throughput, Keto version, OPL
revision labels, fixture parameters, and pass/fail gates.

The command refuses non-loopback endpoints unless
`--allow-non-loopback` is explicitly passed. Override endpoint or fixture
parameters with `--baseline-read-url=...`, `--candidate-write-url=...`,
`--teams=...`, and the corresponding named flags.

A scenario fails when its candidate median p95 is both more than 10% and more
than 1 ms slower, or when concurrency-32 throughput drops by more than 10%.
Fixtures are deleted from both Keto instances in `finally`, including on gate
failure. Attach the complete JSON output to the pull request as required
authorization evidence; do not add this latency-sensitive comparison to CI.
