import type { TSchema } from '@sinclair/typebox';

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
  readonly requiresCriteria: boolean;
  readonly requiresReferences: boolean;
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
    requiresCriteria: false,
    requiresReferences: false,
  },
  [ASSESS_BRIEF_TYPE]: {
    name: ASSESS_BRIEF_TYPE,
    inputSchema: AssessBriefInput,
    outputSchema: AssessBriefOutput,
    outputKind: 'judgment',
    requiresCriteria: true,
    requiresReferences: true,
  },
  [CURATE_PACK_TYPE]: {
    name: CURATE_PACK_TYPE,
    inputSchema: CuratePackInput,
    outputSchema: CuratePackOutput,
    outputKind: 'artifact',
    requiresCriteria: false,
    requiresReferences: false,
  },
  [RENDER_PACK_TYPE]: {
    name: RENDER_PACK_TYPE,
    inputSchema: RenderPackInput,
    outputSchema: RenderPackOutput,
    outputKind: 'artifact',
    requiresCriteria: false,
    requiresReferences: false,
  },
  [JUDGE_PACK_TYPE]: {
    name: JUDGE_PACK_TYPE,
    inputSchema: JudgePackInput,
    outputSchema: JudgePackOutput,
    outputKind: 'judgment',
    // Phase 1: rubric is inline in input, pinned via input_cid — no
    // separate criteria_cid. Phase 2 (#881) flips this to true when the
    // rubric becomes a first-class resource.
    requiresCriteria: false,
    requiresReferences: true,
  },
} as const satisfies Record<string, TaskTypeEntry>;

export type BuiltInTaskType = keyof typeof BUILT_IN_TASK_TYPES;
