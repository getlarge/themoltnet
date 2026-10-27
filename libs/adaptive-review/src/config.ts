import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';
import { parseDocument } from 'yaml';

import { type Lane, LANES } from './policy.js';

const TaskBudgetSchema = Type.Object(
  {
    runningTimeoutSec: Type.Integer({ minimum: 1 }),
    dispatchTimeoutSec: Type.Integer({ minimum: 1 }),
    expiresInSec: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export type TaskBudget = Static<typeof TaskBudgetSchema>;
export const REVIEW_BUDGET_KEYS = ['classifier', 'focused', ...LANES] as const;
export type ReviewBudgetKey = (typeof REVIEW_BUDGET_KEYS)[number];
export type ReviewTaskBudgets = Record<ReviewBudgetKey, TaskBudget>;

const DEFAULT_RUNNING_SECONDS: Record<ReviewBudgetKey, number> = {
  classifier: 90,
  focused: 720,
  docs: 120,
  complexity: 180,
  security: 900,
  tests: 720,
  conventions: 720,
  'blast-radius': 720,
};
const FOCUSED_LANES: readonly string[] = [
  'tests',
  'conventions',
  'blast-radius',
];
const FIELDS = {
  timeout: 'runningTimeoutSec',
  'dispatch-timeout': 'dispatchTimeoutSec',
  'expires-after': 'expiresInSec',
} as const;
const PREFIX = 'ADAPTIVE_TASK_BUDGETS';

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function seconds(value: unknown, path: string): number {
  const match = typeof value === 'string' && /^(\d+)(s|m|h)$/.exec(value);
  const result = match
    ? Number(match[1]) * ({ s: 1, m: 60, h: 3600 }[match[2]] ?? NaN)
    : NaN;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error(
      `${path} must be a positive whole duration such as 90s, 12m, or 1h`,
    );
  }
  return result;
}

/** Validate normalized limits before any review task starts. */
export function validateReviewTaskBudgets(
  value: unknown,
  _lanes: readonly Lane[],
): asserts value is ReviewTaskBudgets {
  if (
    !isMap(value) ||
    Object.keys(value).some(
      (key) => !REVIEW_BUDGET_KEYS.includes(key as ReviewBudgetKey),
    )
  ) {
    throw new Error(`${PREFIX} has invalid task budget fields`);
  }
  for (const key of REVIEW_BUDGET_KEYS) {
    const budget = value[key];
    if (
      !Value.Check(TaskBudgetSchema, budget) ||
      Object.values(budget).some((n) => !Number.isSafeInteger(n))
    ) {
      throw new Error(
        `${PREFIX}.${key} must contain positive safe integer limits`,
      );
    }
    if (
      budget.expiresInSec <
      budget.dispatchTimeoutSec + budget.runningTimeoutSec
    ) {
      throw new Error(
        `${PREFIX}.${key} expires before its dispatch and running budgets`,
      );
    }
  }
}

/** Resolve optional YAML duration overrides into task limits. */
export function parseReviewTaskBudgets(
  raw = '',
  lanes: readonly Lane[] = LANES,
): ReviewTaskBudgets {
  let value: unknown = {};
  if (raw.trim()) {
    const document = parseDocument(raw);
    if (document.errors.length)
      throw new Error(
        `${PREFIX} must be valid YAML (duplicate keys are not allowed)`,
      );
    value = document.toJS({ maxAliasCount: 0 });
  }
  if (!isMap(value)) throw new Error(`${PREFIX} must be a map of review names`);
  const overrides: Partial<Record<ReviewBudgetKey, Partial<TaskBudget>>> = {};
  for (const [key, fields] of Object.entries(value)) {
    if (!REVIEW_BUDGET_KEYS.includes(key as ReviewBudgetKey)) {
      throw new Error(
        `${PREFIX}.${key} is unknown; valid reviews: ${REVIEW_BUDGET_KEYS.join(', ')}`,
      );
    }
    if (!isMap(fields))
      throw new Error(`${PREFIX}.${key} must be a map of timeout overrides`);
    const budget: Partial<TaskBudget> = {};
    for (const [field, input] of Object.entries(fields)) {
      const target = Object.hasOwn(FIELDS, field)
        ? FIELDS[field as keyof typeof FIELDS]
        : undefined;
      if (!target)
        throw new Error(
          `${PREFIX}.${key}.${field} is unknown; use ${Object.keys(FIELDS).join(', ')}`,
        );
      budget[target] = seconds(input, `${PREFIX}.${key}.${field}`);
    }
    overrides[key as ReviewBudgetKey] = budget;
  }
  const resolved = Object.fromEntries(
    REVIEW_BUDGET_KEYS.map((key) => [
      key,
      {
        runningTimeoutSec: DEFAULT_RUNNING_SECONDS[key],
        dispatchTimeoutSec: 300,
        expiresInSec: 3600,
        ...(FOCUSED_LANES.includes(key) ? overrides.focused : {}),
        ...overrides[key],
      },
    ]),
  ) as ReviewTaskBudgets;
  validateReviewTaskBudgets(resolved, lanes);
  return resolved;
}

export function formatReviewTaskBudgets(budgets: ReviewTaskBudgets): string {
  return [
    '### Resolved review task budgets',
    '',
    '| Review | Running | Dispatch | Expiry |',
    '| --- | --- | --- | --- |',
    ...REVIEW_BUDGET_KEYS.map((key) => {
      const budget = budgets[key];
      return `| ${key} | ${budget.runningTimeoutSec}s | ${budget.dispatchTimeoutSec}s | ${budget.expiresInSec}s |`;
    }),
    '',
  ].join('\n');
}

/** Centralize environment reads so review modules receive explicit inputs. */
export function env(): NodeJS.ProcessEnv {
  return process.env;
}

export function required(
  name: string,
  source: NodeJS.ProcessEnv = env(),
): string {
  const value = source[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
