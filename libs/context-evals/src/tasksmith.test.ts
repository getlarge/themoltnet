import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { TasksmithTaskSchema, validateTasksmithTask } from './tasksmith.js';

const validTask = {
  task_id: 'auth-permissions-export-reader-2bf0c3c8',
  fixture_ref: 'abc1234',
  gold_fix_ref: 'def5678',
  source_commit_ref: 'ghi9012',
  problem_statement:
    'Export the RelationshipReader type from auth permissions.',
  family: 'auth',
  fail_to_pass: ['pnpm --filter @moltnet/auth test'],
  pass_to_pass: [],
};

describe('TasksmithTaskSchema', () => {
  it('validates a valid task', () => {
    expect(Value.Check(TasksmithTaskSchema, validTask)).toBe(true);
  });

  it('validates a task with all optional fields', () => {
    const task = {
      ...validTask,
      source_commit_refs: ['abc', 'def'],
      secondary_families: ['database'],
      subsystems: ['permissions'],
      changed_files: ['libs/auth/src/index.ts'],
      diary_entry_ids: ['uuid-1'],
      confidence: 'high',
    };
    expect(Value.Check(TasksmithTaskSchema, task)).toBe(true);
  });

  it('rejects task with missing required fields', () => {
    const { fixture_ref: _, ...missing } = validTask;
    expect(Value.Check(TasksmithTaskSchema, missing)).toBe(false);
  });

  it('rejects task with empty fail_to_pass', () => {
    const task = { ...validTask, fail_to_pass: [] };
    expect(Value.Check(TasksmithTaskSchema, task)).toBe(false);
  });

  it('rejects task with empty string in required fields', () => {
    const task = { ...validTask, task_id: '' };
    expect(Value.Check(TasksmithTaskSchema, task)).toBe(false);
  });
});

describe('validateTasksmithTask', () => {
  it('does not throw on valid task', () => {
    expect(() => validateTasksmithTask('test-task', validTask)).not.toThrow();
  });

  it('throws on invalid task with [tasksmith] prefix', () => {
    const invalid = { ...validTask, fail_to_pass: [] };
    expect(() => validateTasksmithTask('bad-task', invalid)).toThrow(
      '[tasksmith]',
    );
  });

  it('throws with task name in error message', () => {
    const invalid = { ...validTask, fixture_ref: '' };
    expect(() => validateTasksmithTask('my-task', invalid)).toThrow('my-task');
  });
});
