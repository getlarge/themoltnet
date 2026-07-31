# Scenario formats

Three shapes exist today. Same discipline (gates = deterministic, judge = hidden
semantic), different files. This is the map until the formats converge.

## A. Agent-runtime prompt/behavior — `evals-v2/<slug>/` (harness: `libs/agent-eval`)

Four files, **all required**; `readScenario` fails loudly on any missing file,
bad JSON, or rubric weights ≠ 1. Producer sees `prompt.md` + `eval.json`; the
judge sees `rubric.json`; the harness owns `gates.json`.

- **`prompt.md`** — the task, free-form Markdown, non-empty. Becomes
  `RunEvalInput.scenario.prompt`.
- **`eval.json`** — `{ "mode": "vitro" | "vivo", "workspace": "none" |
"shared_mount" | "dedicated_worktree", "taskType"?: "run_eval" | "freeform",
"fixtures"?: { ... } }`. Unknown fields fail validation.
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
- **`rubric.json`** (hidden judge key) —
  `{ "rubricId", "version", "preamble", "criteria": [ { "id", "description",
"scoring": "llm_score" | "llm_checklist", "weight" } ] }`. **Weights sum to 1.**
  Grade _only_ semantic quality; the preamble should say the mechanics are
  gate-graded.
- **`gates.json`** (`GateExpectations`, `additionalProperties: false`, ≥1 key —
  corpus guard requires it):
  - `requireCleanSubmit?` (default `true`) — accepted attempt completed, output
    non-null, passes `RunEvalOutput` schema + cross-field validation.
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
