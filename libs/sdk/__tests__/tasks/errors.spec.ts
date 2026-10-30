import { describe, expect, it } from 'vitest';

import {
  formatValidationErrors,
  TaskBuildError,
  TaskResultError,
} from '../../src/tasks/errors.js';

describe('formatValidationErrors', () => {
  it('renders one line per field error', () => {
    const msg = formatValidationErrors([
      { field: 'input/brief', message: 'must have required property brief' },
      { field: 'references', message: 'at least one reference is required' },
    ]);
    expect(msg).toContain('input/brief: must have required property brief');
    expect(msg).toContain('references: at least one reference is required');
    expect(msg.split('\n')).toHaveLength(2);
  });
});

describe('TaskBuildError', () => {
  it('is an Error carrying the field errors', () => {
    const err = new TaskBuildError([{ field: 'input/brief', message: 'x' }]);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TaskBuildError');
    expect(err.errors).toEqual([{ field: 'input/brief', message: 'x' }]);
    expect(err.message).toContain('input/brief: x');
  });
});

describe('TaskResultError', () => {
  it('is an Error carrying the field errors', () => {
    const err = new TaskResultError([
      { field: 'output/summary', message: 'y' },
    ]);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TaskResultError');
    expect(err.errors).toEqual([{ field: 'output/summary', message: 'y' }]);
  });
});
