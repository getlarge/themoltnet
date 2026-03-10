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

The output is not a polished public benchmark yet. It is a verified internal
task set suitable for:

- early nugget evaluation
- GEPA-style prompt or skill optimization
- task family coverage analysis

## Why this matters

The current eval fixtures were hand-authored and are too easy to get wrong:

- fixture commits can already be green
- broad package-level tests can hide missing task behavior
- criteria/rubric text is not a sufficient scoring objective

Harvesting from real historical fixes gives us a more defensible path:

- real buggy fixture state
- real gold fix
- narrow `FAIL_TO_PASS`
- broader `PASS_TO_PASS`
- provenance back to the underlying code change

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

### 1. Candidate commit export

A machine-readable export of candidate commits, for example:

```text
tasksmith/candidates/commits.jsonl
```

Each record should include:

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

### 2. Candidate task records

Derived tasks before verification, for example:

```text
tasksmith/candidates/tasks/
```

Each record should include:

- `task_id`
- `fixture_ref`
- `gold_fix_ref`
- `source_commit_ref`
- `problem_statement`
- `family`
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

Objective: turn `parent -> commit` into a proposed task.

Derivation rules:

- `fixture_ref = parent_sha`
- `gold_fix_ref = commit_sha`
- generate a readable `problem_statement`
- propose task-specific `fail_to_pass`
- propose stable `pass_to_pass`

Family-specific derivation hints:

#### `rest-api-route`

Prefer:

- changed `apps/rest-api/__tests__/*.test.ts`
- changed `apps/rest-api/e2e/*.e2e.test.ts`
- route-specific `vitest run <file>`

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

Acceptance criteria:

- `fail_to_pass` is not broad package-wide smoke unless nothing narrower exists
- `problem_statement` is understandable without reading the diff

### Workstream D: Verification

Objective: keep only defensible tasks.

Verification algorithm:

1. check out `fixture_ref`
2. run every `fail_to_pass`
3. require at least one failure
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

Mitigations:

- enforce red/green verification
- reject broad verifiers aggressively
- classify by family before deriving commands
- cap near-duplicate task families in the first 30

## Recommended agent split

### Agent A

Owns:

- commit harvesting
- candidate schema
- trailer parsing

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
