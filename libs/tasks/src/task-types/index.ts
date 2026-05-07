import type { TSchema } from '@sinclair/typebox';

import { validateRubricWeights } from '../rubric.js';
import type { SuccessCriteria } from '../success-criteria.js';
import type { OutputKind } from '../wire.js';
import {
  ASSESS_BRIEF_TYPE,
  AssessBriefInput,
  AssessBriefOutput,
} from './assess-brief.js';
import {
  CURATE_PACK_TYPE,
  CuratePackInput,
  CuratePackOutput,
} from './curate-pack.js';
import {
  FULFILL_BRIEF_TYPE,
  FulfillBriefInput,
  FulfillBriefOutput,
} from './fulfill-brief.js';
import {
  JUDGE_PACK_TYPE,
  JudgePackInput,
  JudgePackOutput,
  validateJudgePackOutput,
} from './judge-pack.js';
import {
  RENDER_PACK_TYPE,
  RenderPackInput,
  RenderPackOutput,
} from './render-pack.js';

export * from './assess-brief.js';
export * from './curate-pack.js';
export * from './fulfill-brief.js';
export * from './judge-pack.js';
export * from './render-pack.js';

interface TaskTypeEntry {
  readonly name: string;
  readonly inputSchema: TSchema;
  readonly outputSchema: TSchema;
  readonly outputKind: OutputKind;
  readonly requiresReferences: boolean;
  /**
   * Optional cross-field validator run AFTER `Value.Check(inputSchema)`
   * passes. Use for invariants a TypeBox schema can't express — e.g. a
   * rubric's criteria weights summing to 1.0, or "judgment tasks must
   * carry a rubric inside their successCriteria." Returns null on
   * success, or an error message that surfaces to the task runner.
   */
  readonly validateInput?: (input: unknown) => string | null;
  /**
   * Optional cross-field validator run AFTER `Value.Check(outputSchema)`
   * passes. Use for invariants a TypeBox schema can't express — e.g. for
   * `judge_pack`, an `llm_checklist` criterion's `score` must equal
   * `1` iff every `assertions[].passed` is true (#999). Returns null on
   * success, or an error message that surfaces to the task runner.
   */
  readonly validateOutput?: (output: unknown) => string | null;
}

/**
 * Validate that a judgment-task input carries a rubric inside its
 * `successCriteria` envelope, and that the rubric's weights sum to 1.
 * Used for `assess_brief` and `judge_pack`.
 */
function validateJudgmentInput(input: unknown): string | null {
  const sc = (input as { successCriteria?: SuccessCriteria }).successCriteria;
  if (!sc) {
    return 'successCriteria is required for judgment tasks';
  }
  if (!sc.rubric) {
    return 'successCriteria.rubric is required for judgment tasks';
  }
  return validateRubricWeights(sc.rubric);
}

/**
 * Client-side task-type registry. Mirrors the server-owned DB registry
 * (PR 2). PR 0 shipped the two brief types; this PR adds the three
 * pack-pipeline types for the three-session attribution loop (#875).
 *
 * Consumers validate `Task.input` against
 * `BUILT_IN_TASK_TYPES[task.task_type].inputSchema` before creating
 * / claiming a task.
 */
export const BUILT_IN_TASK_TYPES = {
  [FULFILL_BRIEF_TYPE]: {
    name: FULFILL_BRIEF_TYPE,
    inputSchema: FulfillBriefInput,
    outputSchema: FulfillBriefOutput,
    outputKind: 'artifact',
    requiresReferences: false,
  },
  [ASSESS_BRIEF_TYPE]: {
    name: ASSESS_BRIEF_TYPE,
    inputSchema: AssessBriefInput,
    outputSchema: AssessBriefOutput,
    outputKind: 'judgment',
    requiresReferences: true,
    validateInput: validateJudgmentInput,
  },
  [CURATE_PACK_TYPE]: {
    name: CURATE_PACK_TYPE,
    inputSchema: CuratePackInput,
    outputSchema: CuratePackOutput,
    outputKind: 'artifact',
    requiresReferences: false,
  },
  [RENDER_PACK_TYPE]: {
    name: RENDER_PACK_TYPE,
    inputSchema: RenderPackInput,
    outputSchema: RenderPackOutput,
    outputKind: 'artifact',
    requiresReferences: false,
  },
  [JUDGE_PACK_TYPE]: {
    name: JUDGE_PACK_TYPE,
    inputSchema: JudgePackInput,
    outputSchema: JudgePackOutput,
    outputKind: 'judgment',
    requiresReferences: true,
    validateInput: validateJudgmentInput,
    validateOutput: validateJudgePackOutput,
  },
} as const satisfies Record<string, TaskTypeEntry>;

export type BuiltInTaskType = keyof typeof BUILT_IN_TASK_TYPES;
