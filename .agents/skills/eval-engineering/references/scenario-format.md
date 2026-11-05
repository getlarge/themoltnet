# Scenario formats

Three shapes exist today. Same discipline (gates = deterministic, judge = hidden
semantic), different files. This is the map until the formats converge.

## A. Agent-runtime prompt/behavior — `evals-v2/<slug>/` (harness: `libs/agent-eval`)

Three files for gate-only scenarios; judged scenarios also require
`rubric.json`. `readScenario` fails loudly on malformed JSON, missing required
files, or invalid rubric weights. The producer sees the prompt, execution input,
and declared fixtures; the judge sees `rubric.json` when used. Harness metadata
and `gates.json` are not producer input.

- **`prompt.md`** — the task, free-form Markdown, non-empty. Becomes
  `RunEvalInput.scenario.prompt`.
- **`eval.json`** — `{ "mode": "vitro" | "vivo", "workspace": "none" |
"shared_mount" | "dedicated_worktree", "taskType"?: "run_eval" | "freeform",
"fixtures"?: { ... } }`. Unknown fields fail validation.
  - `scoring?: "judge" | "gates_only"` defaults to `judge`. Gate-only scoring
    requires a freeform `outputContract` and `requireCleanSubmit: true`; a clean
    contracted submission scores 1, otherwise 0, with no judge task.
  - `matrixOnly?: boolean` excludes expensive scenarios from per-PR smoke;
    weekly/manual matrices still discover them.
  - `matrixRepeats?: integer` (1–20, default 1) runs independent matrix trials,
    retaining failures rather than retrying until success.
  - `runningTimeoutSec?: integer` (1–86400) sets the explicit producer task
    budget. This harness metadata is kept out of the task's execution input.
  - `fixtures.workspaceSeed?: string` names a scenario-relative directory whose
    contents are copied into a fresh `shared_mount` sandbox for every producer
    run. Seeds are rejected for other workspace modes. Absolute paths, path
    escapes, symlinks, and non-regular entries are rejected.
  - `fixtures.inputArtifacts?: Array<{ path, role?, kind?, title?,
contentType? }>` names scenario-relative regular files. Every producer run
    stages their bytes through the task-artifact API and binds the resulting
    CIDs to the task. `role` defaults to `context`, `kind` to `eval-input`,
    `title` to the basename, and common text/JSON content types are inferred.
    Use explicit metadata when the artifact contract matters to the scenario.
    The task prompt should tell the producer what it must inspect or create; do
    not leak the host fixture path as an alternate access route.
  - Both fixture forms are repository-agnostic and may be used together. Prefer
    input artifacts when the behavior under test is artifact discovery or
    provenance; prefer a workspace seed when the behavior requires ordinary
    file editing or workspace tools.
- **`rubric.json`** (hidden judge key; judged scenarios only) —
  `{ "rubricId", "version", "preamble", "criteria": [ { "id", "description",
"scoring": "llm_score" | "llm_checklist", "weight" } ] }`. **Weights sum to 1.**
  Grade _only_ semantic quality; the preamble should say the mechanics are
  gate-graded.
- **`gates.json`** (`GateExpectations`, `additionalProperties: false`, ≥1 key —
  corpus guard requires it):
  - `requireCleanSubmit?` (default `true`) — accepted attempt completed, output
    non-null, passes `RunEvalOutput` schema + cross-field validation.
  - `requireDeadlineFinalization?: boolean` requires one observed cutoff and
    completed output within `runningTimeoutSec`, with valid server timestamps.
    Records elapsed and finalization durations. Pair with `requireCleanSubmit`.
  - `expectWorkspaceMode?`
  - `requirePromptSections?: string[]` — section _ids_ in the assembled prompt
    (e.g. `run_eval.header`). Note: ids are emitted regardless of content, so
    this cannot distinguish context-present vs absent.
  - `requireToolCalls?: string[]` / `forbidToolCalls?: string[]` — by tool
    **name** only (gates do not see tool args or artifact bytes).

Gate failure ⇒ composite 0 and the judge is skipped (anti-inception). Scenarios
are auto-discovered (`readdirSync(evals-v2)`); no registration.

**A/B seam:** `buildRunEvalInput(scenario, { variant, context })`. `variant:
'baseline'` ⇒ `context: []`. Supply a recipe (e.g.
`resolveRuntimeProfileContextRecipe('standard-engineering@v1')`, ≤5 `prompt_prefix`
entries) as `context` for the treatment arm. Both live runners currently hardcode
`baseline`; a real A/B needs a variant axis in the runner or two runtime profiles.

**Runtime profile:** the live suites share one generic profile
(`createEvalProfile` in `apps/agent-daemon-e2e/src/fixtures.ts`: plain
`gondolin_pi`, no tool policy). To measure a producer under a production
profile instead, use `createCommittedEvalProfile({ agent, teamId, profileName,
overrides })`. It loads `.github/runtime-profiles/<profileName>.json` and the
policies bound to it in `.github/runtime-policy-bindings.json`
(`loadCommittedRuntimeProfile` in `libs/agent-eval`). It then creates them on
the e2e stack under unique names, checks the server's resolved allow-set
against the committed policies, and returns `cleanup()`. Overrides are limited
to what the e2e environment must change: the name suffix,
`generation`/`classification` model, `requiredEnv`, `sandboxEnv` (merged), and
`sandboxResources`. Context, tool enforcement, VFS, network, turn and timeout
budgets, workspace modes, and required tools stay as committed. A model override
keeps the committed sampling fields. Set one to `null` if the e2e model rejects
it. The scenario's `execution.workspace` must be one of the profile's
`allowedWorkspaceModes`; most review profiles allow only `dedicated_worktree`.
Diary-backed `adaptive_review_pi` profiles can be created, but the in-process
e2e daemon does not load that runtime module. Their host-only
`ADAPTIVE_REVIEW_DIARY_IDS` is rejected as a sandbox override.

## B. Repo-practice / incident regression — `evals/moltnet-practices/<slug>/`

- **`task.md`** — a straightforward implementation/debug request. Must **not**
  name the gotcha.
- **`criteria.json`** — `{ "type": "weighted_checklist", "checklist": [ { "name",
"description", "max_score" } ], "context": "<judge-only rationale>" }`. Because
  it's judge-scored, keep mechanical facts out of the checklist where a gate could
  own them; keep ≥40% of `max_score` on articulation.
- Optional `eval.json` / fixtures.

Run via `moltnet eval run --scenario evals/moltnet-practices/<slug>`. Gold
standard: `dbos-after-commit` (20% baseline).

## C. Context-pack value (gap-test) — scenario + `--pack`

Same scenario files as B, plus a rendered pack. `moltnet eval run --scenario
<path> --pack <rendered-pack.md>` runs both arms and reports the **delta** — the
delta is the pack's proven value. This is the "pack eval" use case, nothing more.

## Convergence note

The end state is one corpus + one runner with `gates` (deterministic) and
`rubric` (hidden judge) as first-class stages, and the B/C weighted-checklist
expressed as judge criteria with mechanical items promoted to gates. Until then,
review every shape with the same checklist.
