import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_TASK_TYPES,
  FREEFORM_TYPE,
  PR_REVIEW_TYPE,
  RUN_EVAL_TYPE,
} from './index.js';

describe('BUILT_IN_TASK_TYPES — freeform', () => {
  it('includes freeform as an artifact-kind discovery lane', () => {
    const entry = BUILT_IN_TASK_TYPES[FREEFORM_TYPE];
    expect(entry).toBeDefined();
    expect(entry.name).toBe('freeform');
    expect(entry.outputKind).toBe('artifact');
    expect(entry.requiresReferences).toBe(false);
    expect(entry.validateOutput).toBeDefined();
  });
});

describe('BUILT_IN_TASK_TYPES — run_eval', () => {
  it('includes run_eval as an artifact-kind type', () => {
    const entry = BUILT_IN_TASK_TYPES[RUN_EVAL_TYPE];
    expect(entry).toBeDefined();
    expect(entry.name).toBe('run_eval');
    expect(entry.outputKind).toBe('artifact');
    expect(entry.requiresReferences).toBe(false);
    expect(entry.validateOutput).toBeDefined();
    // No validateInput on run_eval (input has no cross-field invariants).
    expect('validateInput' in entry).toBe(false);
  });
});

describe('BUILT_IN_TASK_TYPES — pr_review', () => {
  it('includes pr_review as a judgment-kind dedicated-worktree type', () => {
    const entry = BUILT_IN_TASK_TYPES[PR_REVIEW_TYPE];
    expect(entry).toBeDefined();
    expect(entry.name).toBe('pr_review');
    expect(entry.outputKind).toBe('judgment');
    expect(entry.requiresReferences).toBe(false);
    expect(entry.workspaceMode).toBe('dedicated_worktree');
    expect(entry.workspaceScope).toBe('attempt');
    expect(entry.sessionScope).toBe('none');
  });
});
