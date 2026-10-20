import { describe, expect, it } from 'vitest';

import { parseReviewTaskBudgets } from './config.js';

describe('caller task budgets', () => {
  it('requires budgets only for enabled repository-reading lanes', () => {
    const focused = {
      runningTimeoutSec: 420,
      dispatchTimeoutSec: 120,
      expiresInSec: 900,
    };

    expect(
      parseReviewTaskBudgets(JSON.stringify({ focused }), ['tests']),
    ).toEqual({ focused });
    expect(() => parseReviewTaskBudgets('{}', ['security'])).toThrow(
      'ADAPTIVE_TASK_BUDGETS.security is required',
    );
    expect(() => parseReviewTaskBudgets('{}', ['conventions'])).toThrow(
      'ADAPTIVE_TASK_BUDGETS.focused is required',
    );
  });

  it('rejects malformed or internally inconsistent limits before tasks start', () => {
    expect(() => parseReviewTaskBudgets('{', ['tests'])).toThrow('valid JSON');
    expect(() =>
      parseReviewTaskBudgets(
        JSON.stringify({
          focused: {
            runningTimeoutSec: 100,
            dispatchTimeoutSec: 60,
            expiresInSec: 150,
          },
        }),
        ['tests'],
      ),
    ).toThrow('expires before its dispatch and running budgets');
    expect(() =>
      parseReviewTaskBudgets(
        JSON.stringify({
          focused: {
            runningTimeoutSec: -1,
            dispatchTimeoutSec: 60,
            expiresInSec: 900,
          },
        }),
        ['tests'],
      ),
    ).toThrow('invalid task budget fields');
  });
});
