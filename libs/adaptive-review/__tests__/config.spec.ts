import { describe, expect, it } from 'vitest';

import {
  formatReviewTaskBudgets,
  parseReviewTaskBudgets,
  REVIEW_BUDGET_KEYS,
} from '../src/config.js';
import { LANES } from '../src/policy.js';

describe('caller task budgets', () => {
  it('provides defaults when input or fields are omitted', () => {
    const defaults = parseReviewTaskBudgets();
    expect(parseReviewTaskBudgets('{}')).toEqual(defaults);
    expect(parseReviewTaskBudgets('security: {}')).toEqual(defaults);
    expect(defaults.classifier.runningTimeoutSec).toBe(90);
    expect(defaults.docs.runningTimeoutSec).toBe(120);
    expect(defaults.complexity.runningTimeoutSec).toBe(180);
    expect(defaults.focused.runningTimeoutSec).toBe(720);
    expect(defaults.security.runningTimeoutSec).toBe(900);
    for (const budget of Object.values(defaults)) {
      expect(budget.dispatchTimeoutSec).toBe(300);
      expect(budget.expiresInSec).toBe(3600);
    }
    expect(REVIEW_BUDGET_KEYS).toEqual(['classifier', 'focused', ...LANES]);
  });

  it('merges each field and lets individual lanes override focused defaults', () => {
    const budgets = parseReviewTaskBudgets(`
focused:
  timeout: 10m
  dispatch-timeout: 2m
tests:
  timeout: 8m
security:
  timeout: 20m
  expires-after: 2h
classifier:
  timeout: 45s
docs:
  timeout: 5m
complexity:
  timeout: 4m
`);
    expect(budgets.tests).toEqual({
      runningTimeoutSec: 480,
      dispatchTimeoutSec: 120,
      expiresInSec: 3600,
    });
    expect(budgets.conventions).toEqual(budgets.focused);
    expect(budgets['blast-radius']).toEqual(budgets.focused);
    expect(budgets.security).toEqual({
      runningTimeoutSec: 1200,
      dispatchTimeoutSec: 300,
      expiresInSec: 7200,
    });
    expect(budgets.classifier.runningTimeoutSec).toBe(45);
    expect(budgets.docs.runningTimeoutSec).toBe(300);
    expect(budgets.complexity.runningTimeoutSec).toBe(240);
  });

  it.each([
    ['{', 'valid YAML'],
    ['[]', 'map of review names'],
    ['null', 'map of review names'],
    ['securty: {}', 'valid reviews:'],
    ['security: 15m', 'map of timeout overrides'],
    ['docs: { timeot: 2m }', 'ADAPTIVE_TASK_BUDGETS.docs.timeot'],
    ['docs: { timeout: 0m }', 'positive whole duration'],
    ['docs: { timeout: 1.5m }', 'positive whole duration'],
    ['docs: { timeout: 30 }', 'positive whole duration'],
    ['docs: { timeout: 9999999999999999h }', 'positive whole duration'],
    ['docs: { runningTimeoutSec: 120 }', 'unknown; use timeout'],
    ['docs: { dispatchTimeoutSec: 300 }', 'unknown; use timeout'],
    ['docs: { expiresInSec: 3600 }', 'unknown; use timeout'],
    ['docs: { timeout: 2m, timeout: 3m }', 'duplicate keys'],
    [
      'security: { timeout: 1h }',
      'expires before its dispatch and running budgets',
    ],
    [
      'focused: { expires-after: 10m }',
      'expires before its dispatch and running budgets',
    ],
  ])('rejects invalid configuration %s', (raw, error) => {
    expect(() => parseReviewTaskBudgets(raw)).toThrow(error);
  });

  it('reports resolved limits for every review without mutating later defaults', () => {
    const budgets = parseReviewTaskBudgets('docs: {timeout: 5m}');
    expect(formatReviewTaskBudgets(budgets)).toContain(
      '| docs | 300s | 300s | 3600s |',
    );
    budgets.docs.runningTimeoutSec = 1;
    expect(parseReviewTaskBudgets().docs.runningTimeoutSec).toBe(120);
  });
});
