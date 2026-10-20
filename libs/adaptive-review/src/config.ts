import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

import type { Lane } from './policy.js';

const TaskBudgetSchema = Type.Object(
  {
    runningTimeoutSec: Type.Integer({ minimum: 1 }),
    dispatchTimeoutSec: Type.Integer({ minimum: 1 }),
    expiresInSec: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const ReviewTaskBudgetsSchema = Type.Object(
  {
    focused: Type.Optional(TaskBudgetSchema),
    security: Type.Optional(TaskBudgetSchema),
  },
  { additionalProperties: false },
);

export type TaskBudget = Static<typeof TaskBudgetSchema>;
export type ReviewTaskBudgets = Static<typeof ReviewTaskBudgetsSchema>;

/** Validate caller-owned runtime limits before any review task starts. */
export function validateReviewTaskBudgets(
  value: unknown,
  lanes: readonly Lane[],
): asserts value is ReviewTaskBudgets {
  if (!Value.Check(ReviewTaskBudgetsSchema, value)) {
    throw new Error('ADAPTIVE_TASK_BUDGETS has invalid task budget fields');
  }
  const required = new Set(
    lanes.map((lane) =>
      lane === 'tests' || lane === 'conventions' || lane === 'blast-radius'
        ? 'focused'
        : lane,
    ),
  );
  for (const key of ['focused', 'security'] as const) {
    const budget = value[key];
    if (required.has(key) && !budget)
      throw new Error(`ADAPTIVE_TASK_BUDGETS.${key} is required`);
    if (
      budget &&
      Object.values(budget).some((seconds) => !Number.isSafeInteger(seconds))
    ) {
      throw new Error(`ADAPTIVE_TASK_BUDGETS.${key} must use safe integers`);
    }
    if (
      budget &&
      budget.expiresInSec < budget.dispatchTimeoutSec + budget.runningTimeoutSec
    ) {
      throw new Error(
        `ADAPTIVE_TASK_BUDGETS.${key} expires before its dispatch and running budgets`,
      );
    }
  }
}

/** Parse the reusable workflow's JSON input. */
export function parseReviewTaskBudgets(
  raw: string,
  lanes: readonly Lane[],
): ReviewTaskBudgets {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('ADAPTIVE_TASK_BUDGETS must be valid JSON');
  }
  validateReviewTaskBudgets(value, lanes);
  return value;
}

/** Centralize environment reads so review modules receive explicit inputs. */
export function env(): NodeJS.ProcessEnv {
  return process.env;
}

export function required(name: string): string {
  const value = env()[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
