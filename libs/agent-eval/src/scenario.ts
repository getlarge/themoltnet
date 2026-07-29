/**
 * `evals-v2` scenario format — the on-disk contract the harness reads.
 *
 * A scenario is a directory `evals-v2/<slug>/` with four files:
 *
 * - `prompt.md`   — the scenario prompt (free-form Markdown). Becomes
 *                   `RunEvalInput.scenario.prompt`.
 * - `eval.json`   — `{ mode, workspace }`, the `RunEvalExecution` shape.
 * - `rubric.json` — a `Rubric` (see `@moltnet/tasks`): the HIDDEN judge key.
 *                   Never handed to the producer; only the `judge_eval_attempt`
 *                   task sees it. Weights must sum to 1.
 * - `gates.json`  — the deterministic stage-1 gate expectations (this file's
 *                   `GateExpectations`). Checked in code before any LLM judge
 *                   runs; a gate failure short-circuits scoring to composite 0.
 *
 * The split is deliberate: `prompt.md` + `eval.json` are producer-visible;
 * `rubric.json` is judge-only; `gates.json` is harness-only. This mirrors the
 * `run_eval` / `judge_eval_attempt` producer/judge separation in
 * `libs/tasks/src/task-types/`.
 */
import type { Rubric } from '@moltnet/tasks';
import type { RunEvalExecution } from '@moltnet/tasks';
import { type Static, Type } from 'typebox';

/**
 * Deterministic gate expectations for a scenario. Every field is optional so a
 * scenario only asserts what it cares about; an omitted field is not checked.
 * All of these are code-assertable from the attempt's message stream + output,
 * with no LLM involved (see `check-gates.ts`).
 */
export const GateExpectations = Type.Object(
  {
    /**
     * The `submit_<type>_output` tool must have captured a schema-valid
     * payload exactly once, with zero invalid submit attempts. Maps to the
     * `parse_result` OTel code `captured_via_tool` and the absence of
     * `output_validation_failed`. Default (when omitted): true — every
     * runtime-prompt-compliance scenario expects a clean submit.
     */
    requireCleanSubmit: Type.Optional(Type.Boolean()),
    /**
     * The `execute_start` event must report this `workspaceMode`. When omitted,
     * defaults to the `eval.json` `workspace` value (the two should agree; this
     * override exists for cases where the runtime remaps the mode).
     */
    expectWorkspaceMode: Type.Optional(Type.String({ minLength: 1 })),
    /**
     * `prompt_assembled` must be present and carry every one of these section
     * ids (see `PromptSectionTrace.id` in `@moltnet/agent-runtime`). Use this
     * to assert the runtime prompt actually wove in a given block for this
     * model — e.g. `final_output`, `run_eval.scenario`.
     */
    requirePromptSections: Type.Optional(
      Type.Array(Type.String({ minLength: 1 })),
    ),
    /**
     * Tool names that must appear in the attempt's tool-call stream (e.g.
     * `moltnet_upload_task_artifact`, `moltnet_create_entry`). Asserts the
     * model reached for the expected capability rather than a shell shortcut.
     */
    requireToolCalls: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    /**
     * Tool names that must NOT appear (e.g. `bash` for a diary-discipline
     * scenario where the model must use `moltnet_create_entry`, not shell).
     */
    forbidToolCalls: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    /**
     * Each regex (RegExp source, no flags) must match the accepted attempt's
     * submitted `response` string. Use for deterministic format checks — e.g.
     * "exactly three `- ` bullet lines and nothing else" — that must never be
     * handed to the LLM judge.
     */
    responseMustMatch: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    /**
     * Each regex (RegExp source, no flags) must NOT match the submitted
     * `response` string.
     */
    responseMustNotMatch: Type.Optional(
      Type.Array(Type.String({ minLength: 1 })),
    ),
    /**
     * Safety tripwire: no artifact uploaded during the attempt may contain
     * content matching any of these regexes (RegExp source). The gate lists the
     * attempt's artifacts, downloads each, and scans the bytes — so a secret,
     * credential, or PII pattern leaked into an upload hard-fails the scenario.
     * Requires an `expected.teamId` for the artifact API.
     */
    forbidArtifactContentMatching: Type.Optional(
      Type.Array(Type.String({ minLength: 1 })),
    ),
  },
  { $id: 'GateExpectations', additionalProperties: false },
);
export type GateExpectations = Static<typeof GateExpectations>;

/**
 * A fully-parsed scenario. `slug` is the directory name; it namespaces the
 * variant label and the rubric id at runtime.
 */
/** The producer task type a scenario drives. Defaults to `run_eval`. */
export type ScenarioTaskType = 'run_eval' | 'freeform';

export const SCENARIO_TASK_TYPES: readonly ScenarioTaskType[] = [
  'run_eval',
  'freeform',
];

export interface Scenario {
  /** Directory name, e.g. `submit-output-compliance`. */
  slug: string;
  /**
   * Producer task type, from `eval.json`'s optional `taskType` (default
   * `run_eval`). For `freeform`, `prompt.md` is the `FreeformInput.brief`
   * rather than the `RunEvalInput.scenario.prompt`.
   */
  taskType: ScenarioTaskType;
  /** Contents of `prompt.md` — the producer prompt (run_eval) or brief (freeform). */
  prompt: string;
  /** Parsed `eval.json` execution shape — `{ mode, workspace }`. */
  execution: Static<typeof RunEvalExecution>;
  /** Parsed `rubric.json` — the hidden judge rubric (weights sum to 1). */
  rubric: Static<typeof Rubric>;
  /** Parsed `gates.json` — deterministic stage-1 expectations. */
  gates: GateExpectations;
}
