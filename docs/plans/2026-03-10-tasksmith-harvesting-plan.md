# Plan: Tasksmith Harvesting for the First 30 MoltNet Tasks

Date: 2026-03-10
Status: Draft execution plan
Related docs:

- [swesmith-inspection.md](../research/swesmith-inspection.md)
- [moltnet-task-record-regen-api-clients-excludetags.md](../research/moltnet-task-record-regen-api-clients-excludetags.md)
- [GPACK_PIPELINE.md](../GPACK_PIPELINE.md)

## Goal

Build enough tooling to extract and verify the first 30 useful MoltNet task
records from git history.

Start with commits that include a `MoltNet-Diary:` trailer, then expand to
regular commits once the trailer-linked pool is exhausted.

Do not assume one commit equals one task. Use a single commit when the red/green
boundary is clean, but support short commit ranges when the effective fix spans
multiple adjacent commits.

The output is not a polished public benchmark yet. It is a verified internal
task set suitable for:

- early nugget evaluation
- GEPA-style prompt or skill optimization
- task family coverage analysis

## Why this matters

The current eval fixtures were hand-authored and are too easy to get wrong:

- fixture commits can already be green
- broad package-level tests can hide missing task behavior
- typecheck-only validation can miss real API regressions that only show up in
  e2e flows
- criteria/rubric text is not a sufficient scoring objective

Harvesting from real historical fixes gives us a more defensible path:

- real buggy fixture state
- real gold fix
- narrow `FAIL_TO_PASS`
- broader `PASS_TO_PASS`
- provenance back to the underlying code change

Many MoltNet fixes are not single-commit fixes. A behavior change, follow-up
test update, regeneration step, and package wiring adjustment may land across
2-4 adjacent commits. Treating each commit as an isolated task candidate
systematically undercounts usable tasks and overproduces `fix_not_green`
rejections.

## Monorepo constraints

Task derivation must respect MoltNet's actual structure.

Important subsystem boundaries:

- `apps/rest-api`: route wiring, app composition, workflows, OpenAPI generation
- `libs/diary-service`: diary domain logic and workflows
- `libs/database`: repositories, migrations, DBOS workflows
- `libs/auth`: auth, Keto, token validation, permission checks
- `apps/mcp-server`: MCP tool/resource layer over the REST/API surface
- `libs/api-client`: generated TypeScript client
- `cmd/moltnet-api-client`: generated Go client
- `libs/sdk`, `packages/cli`, `packages/github-agent`: publishable external
  surfaces

Implication: a change in `apps/rest-api/src/routes/**` is often only the top of
the iceberg. The real task may span service, database, auth, generated client,
and publishable package surfaces.

Also, many important correctness properties are only exercised end-to-end:

- REST route registration and plugin wiring
- auth and permission behavior through the HTTP surface
- workflow wiring and cross-plugin initialization
- MCP-to-API integration behavior

Implication: `PASS_TO_PASS` should include targeted e2e validation when the
historical fix changed an integration surface that is primarily defended by e2e
tests.

## Target output

Produce a seed set of 30 verified task records with this rough family mix:

- 10 `rest-api` or service-integration tasks
- 5 `mcp-server` tasks
- 5 `codegen` tasks
- 5 `auth` or permissions tasks
- 5 publishable package tasks (`sdk`, `cli`, `github-agent`)

The exact mix can drift, but no single family should dominate more than half
the set.

## Deliverables

### 1. Candidate commit and commit-range export

A machine-readable export of candidate commits, for example:

```text
tasksmith/candidates/commits.jsonl
```

Each single-commit record should include:

- `commit_sha`
- `parent_sha`
- `subject`
- `body`
- `has_diary_trailer`
- `diary_entry_ids[]`
- `changed_files[]`
- `family`
- `subsystems[]`
- `confidence`

Also produce a grouped-candidate export for likely multi-commit fixes, for
example:

```text
tasksmith/candidates/commit-groups.jsonl
```

Each grouped record should include:

- `group_id`
- `start_commit_sha`
- `end_commit_sha`
- `fixture_ref` (`parent(start_commit_sha)`)
- `commit_shas[]`
- `subjects[]`
- `has_diary_trailer`
- `diary_entry_ids[]`
- `changed_files[]`
- `family`
- `secondary_families[]`
- `subsystems[]`
- `confidence`
- `grouping_reason`

### 2. Candidate task records

Derived tasks before verification, for example:

```text
tasksmith/candidates/tasks/
```

Each record should include:

- `task_id`
- `fixture_ref`
- `gold_fix_ref`
- `source_commit_ref` or `source_commit_refs[]`
- `problem_statement`
- `family`
- `secondary_families[]`
- `subsystems[]`
- `changed_files[]`
- `fail_to_pass[]`
- `pass_to_pass[]`
- `diary_entry_ids[]`

### 3. Verification results

A verified/rejected split, for example:

```text
tasksmith/verified/
tasksmith/rejected/
```

Rejected tasks must record why they failed:

- `fixture_already_green`
- `fix_not_green`
- `pass_to_pass_unstable`
- `insufficient_verifier`
- `duplicate`
- `unsupported_task_family`

### 4. First-30 seed report

A short summary artifact with:

- total candidates scanned
- total verified
- total rejected
- rejection reasons
- family histogram
- diary-linked vs regular split

## Workstreams

### Workstream A: Commit harvesting

Objective: extract likely task-bearing commits from history.

Rules:

- start with non-merge commits
- include commits with `MoltNet-Diary:` trailers by default
- then include regular commits with subjects like:
  - `fix(`
  - `feat(`
  - `test(`
  - selective `chore(` such as regeneration tasks
- exclude:
  - release commits
  - docs-only commits
  - lockfile-only commits
  - formatting-only commits

Useful git shape:

```bash
git log --no-merges --format='%H%x09%P%x09%s%n%B%n==END==' --all
```

Acceptance criteria:

- trailer-linked commits are extracted correctly
- parent commit is captured
- changed files are attached

### Workstream A2: Commit grouping

Objective: recover valid tasks whose effective fix spans multiple adjacent
commits.

Why:

- `fix_not_green` often means the chosen gold-fix commit is incomplete, not that
  the task itself is invalid
- route, workflow, and codegen changes often land as short chains:
  - behavior commit
  - test follow-up
  - regeneration commit
  - typecheck/package wiring cleanup

Grouping rules:

- group only short contiguous chains, typically 2-4 commits
- require overlapping changed files or clearly shared subsystems
- require compatible family classification
- prefer chains with:
  - similar subjects
  - shared diary entry ids
  - close timestamps
  - obvious follow-up language such as `fix`, `regen`, `typecheck`, `tests`
- do not group across:
  - merges
  - docs-only or release commits
  - broad unrelated refactors

Examples of good grouped tasks:

- route behavior commit + test follow-up
- schema/service change + generated client regeneration
- workflow implementation + DB/package wiring follow-up

Acceptance criteria:

- grouped candidates are emitted separately from single-commit candidates
- every group records why it was grouped
- grouping is conservative; ambiguous chains are left ungrouped

### Workstream B: Family classification

Objective: classify candidates so verifier generation is family-aware.

Initial families:

- `rest-api-route`
- `service-logic`
- `auth-permissions`
- `mcp-tooling`
- `codegen`
- `database-migration`
- `sdk-package`
- `cli-package`
- `github-agent-package`
- `observability`
- `infra-or-e2e`
- `mixed`

Example classification rules:

- changes under `apps/rest-api/src/routes/**` => `rest-api-route`
- changes under `libs/diary-service/**` or `libs/database/**` =>
  `service-logic`
- changes under `libs/auth/**` => `auth-permissions`
- changes under `apps/mcp-server/src/*tools.ts` => `mcp-tooling`
- simultaneous changes in:
  - `apps/rest-api/public/openapi.json`
  - `libs/api-client/src/generated/**`
  - `cmd/moltnet-api-client/**`
    => `codegen`
- changes under `libs/sdk/**` => `sdk-package`
- changes under `packages/cli/**` => `cli-package`
- changes under `packages/github-agent/**` => `github-agent-package`

Acceptance criteria:

- every candidate gets one family or `mixed`
- ambiguous cases are marked low-confidence instead of guessed silently

### Workstream C: Candidate derivation

Objective: turn either `parent -> commit` or `parent(first) -> last(commit
chain)` into a proposed task.

Derivation rules:

- single-commit task:
  - `fixture_ref = parent_sha`
  - `gold_fix_ref = commit_sha`
- grouped task:
  - `fixture_ref = parent(start_commit_sha)`
  - `gold_fix_ref = end_commit_sha`
- generate a readable `problem_statement`
- propose task-specific `fail_to_pass`
- propose stable `pass_to_pass`
- preserve provenance:
  - `source_commit_ref` for single-commit tasks
  - `source_commit_refs[]` for grouped tasks

Family-specific derivation hints:

#### `rest-api-route`

Prefer:

- changed `apps/rest-api/__tests__/*.test.ts`
- changed `apps/rest-api/e2e/*.e2e.test.ts`
- route-specific `vitest run <file>`

Also consider targeted e2e commands when the change affects route registration,
auth, plugin wiring, or cross-service behavior.

Use `rg` checks only as a supplemental narrow assertion.

#### `service-logic`

Prefer:

- changed `libs/diary-service/__tests__/*`
- changed `libs/database/__tests__/*`
- integration tests tied to the changed service/repository

#### `mcp-tooling`

Prefer:

- changed `apps/mcp-server/__tests__/*`
- target tool-specific tests
- targeted MCP e2e suites when the changed behavior crosses the network/API
  boundary

#### `codegen`

Prefer:

- narrow `rg` checks over exact generated outputs
- plus stability commands such as:
  - `pnpm --filter @moltnet/api-client run typecheck`
  - `pnpm run go:vet`

#### Publishable packages

Prefer:

- package-local unit tests
- packability or typecheck checks
- avoid app-level test suites when package-local checks exist

#### `pass_to_pass` guidance

Prefer the smallest stable command set that protects surrounding behavior.

Use, in order of preference:

- targeted unit/integration tests tied to the changed surface
- targeted e2e tests for API-facing behavior
- package-local typecheck
- broader package-local test commands only when no narrower verifier exists

Do not rely on typecheck alone when the historical fix is about runtime API
behavior.

Acceptance criteria:

- `fail_to_pass` is not broad package-wide smoke unless nothing narrower exists
- `pass_to_pass` is not typecheck-only when the task changes an API or e2e
  integration surface with existing targeted e2e coverage
- `problem_statement` is understandable without reading the diff
- grouped tasks prefer the smallest commit span that produces a green gold fix

### Workstream D: Verification

Objective: keep only defensible tasks.

Verification algorithm:

1. check out `fixture_ref`
2. run every `fail_to_pass`
3. require the verifier to be meaningfully red
4. check out `gold_fix_ref`
5. run every `fail_to_pass`
6. require all to pass
7. run every `pass_to_pass` on both refs
8. require all to pass

Optional but recommended:

- reject tasks whose verifier depends on the whole monorepo when a narrow package
  check exists
- reject tasks whose commands are too slow for repeated evaluation
- detect near-duplicates by changed files + command overlap
- when a single-commit candidate fails as `fix_not_green`, allow derive to
  retry it as a grouped candidate before discarding the whole task family
- when the changed surface is route, auth, workflow, or MCP integration,
  prefer targeted e2e validation in `pass_to_pass` before falling back to
  package-level smoke

Acceptance criteria:

- every verified task is red on fixture and green on fix
- rejection reason is recorded for every rejected task

### Workstream E: First-30 curation

Objective: select a useful seed set from verified tasks.

Selection rules:

- prioritize diary-linked tasks first
- then fill with regular commits
- avoid duplicates from the same issue/fix chain
- maintain family diversity
- include at least 5 cross-language or generated-artifact tasks

Target split:

- at least 10 diary-linked tasks
- at least 20 regular tasks

If the repo does not yield 10 verified diary-linked tasks yet, document the
actual count and fill the rest with regular commits.

## Suggested tooling

Build only the minimum needed:

1. `tasksmith harvest-commits`
2. `tasksmith classify`
3. `tasksmith derive`
4. `tasksmith verify`
5. `tasksmith report`

Do not build continuous automation yet.

## Acceptance criteria

This plan is successful when the repo has:

- at least 30 verified task records
- clear verification provenance for each record
- a family histogram showing coverage
- a documented diary-linked subset

## Risks

- too many commits are not task-shaped
- verifier derivation may be too broad
- route-layer tasks may hide deeper service/database behavior
- regeneration commits may cluster too tightly and reduce diversity
- one-commit task boundaries may be too narrow for monorepo fixes
- typecheck-only `pass_to_pass` may miss true API regressions

Mitigations:

- enforce red/green verification
- reject broad verifiers aggressively
- classify by family before deriving commands
- cap near-duplicate task families in the first 30
- support short commit ranges for fixes that land across adjacent commits
- use targeted e2e suites when they are the real stability surface for the
  changed behavior

## Recommended agent split

### Agent A

Owns:

- commit harvesting
- candidate schema
- trailer parsing
- commit-group candidate generation

### Agent B

Owns:

- family classifier
- monorepo-aware derivation heuristics

### Agent C

Owns:

- verifier
- red/green execution
- rejection reasons

### Agent D

Owns:

- first-30 curation
- coverage report
