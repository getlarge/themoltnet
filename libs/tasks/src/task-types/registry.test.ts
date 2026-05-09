import { describe, expect, it } from 'vitest';

import { BUILT_IN_TASK_TYPES, RUN_EVAL_TYPE } from './index.js';

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
