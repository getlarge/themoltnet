import type { TSchema } from '@sinclair/typebox';

import type { OutputKind } from '../wire.js';
import {
  ASSESS_BRIEF_TYPE,
  AssessBriefInput,
  AssessBriefOutput,
} from './assess-brief.js';
import {
  FULFILL_BRIEF_TYPE,
  FulfillBriefInput,
  FulfillBriefOutput,
} from './fulfill-brief.js';

export * from './assess-brief.js';
export * from './fulfill-brief.js';

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
 * (PR 2). PR 0 ships the two demo types; extended to four built-ins in PR 2.
 *
 * Consumers validate `Task.input` against `BUILT_IN_TASK_TYPES[task.task_type].inputSchema`
 * before creating / claiming a task.
 */
export const BUILT_IN_TASK_TYPES: Record<string, TaskTypeEntry> = {
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
};

export type BuiltInTaskType = keyof typeof BUILT_IN_TASK_TYPES;
