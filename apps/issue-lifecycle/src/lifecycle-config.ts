import { readFileSync } from 'node:fs';

import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

/**
 * Per-step runtime configuration for the issue lifecycle.
 *
 * Each lifecycle step can be pinned to a MoltNet runtime profile (which fixes
 * provider + model + sandbox policy server-side) and given a per-task
 * `maxAttempts` (the MoltNet API task attempt limit sent in the createTask
 * body, not a workflow-level retry).
 *
 * This is operational policy — which model runs which step, how many attempts
 * each gets — so it lives in an external JSON file, validated with TypeBox on
 * load, rather than hardcoded constants. The file is optional: steps with no
 * entry fall back to the lifecycle's built-in defaults (no profile allowlist =
 * any daemon may claim; the constant attempt counts).
 */

/**
 * Upper bound on configurable task attempts. The MoltNet API only requires
 * `maxAttempts >= 1`; this ceiling is a lifecycle-policy guard against
 * pathological values (e.g. retrying a coding task 1000 times). Raise if a
 * legitimate step ever needs more.
 */
const MAX_CONFIGURABLE_ATTEMPTS = 10;

export const LifecycleStepNames = [
  'triage',
  'plan',
  'planReview',
  'planRevision',
  'implement',
  'prReviewComplexity',
  'prReviewFunctional',
  'prReviewSecurity',
  'reviewResolution',
  'supervisor',
  'notify',
] as const;

export type LifecycleStepName = (typeof LifecycleStepNames)[number];

const StepConfig = Type.Object(
  {
    /** MoltNet runtime profile id; pins provider/model/sandbox for this step. */
    profileId: Type.Optional(Type.String({ format: 'uuid' })),
    /** MoltNet API task attempt limit (createTask body `maxAttempts`). */
    maxAttempts: Type.Optional(
      Type.Integer({ minimum: 1, maximum: MAX_CONFIGURABLE_ATTEMPTS }),
    ),
  },
  { additionalProperties: false },
);
export type StepConfig = Static<typeof StepConfig>;

// Inline the step schema per property rather than Type.Ref — refs would need a
// registered schema module to resolve, and inlining keeps validation
// self-contained (Value.Check works with no external reference map).
const optionalStep = () => Type.Optional(StepConfig);

export const LifecycleConfigSchema = Type.Object(
  {
    // Well-known JSON metadata keys — allowed so config files can be
    // self-documenting (JSON has no native comments). Ignored at runtime.
    $schema: Type.Optional(Type.String()),
    $comment: Type.Optional(Type.String()),
    triage: optionalStep(),
    plan: optionalStep(),
    planReview: optionalStep(),
    planRevision: optionalStep(),
    implement: optionalStep(),
    prReviewComplexity: optionalStep(),
    prReviewFunctional: optionalStep(),
    prReviewSecurity: optionalStep(),
    reviewResolution: optionalStep(),
    supervisor: optionalStep(),
    notify: optionalStep(),
  },
  { additionalProperties: false },
);
export type LifecycleConfig = Static<typeof LifecycleConfigSchema>;

/** A fully-empty config — every step falls back to built-in defaults. */
export const EMPTY_LIFECYCLE_CONFIG: LifecycleConfig = {};

function formatErrors(value: unknown): string {
  return [...Value.Errors(LifecycleConfigSchema, value)]
    .map((error) => {
      const { instancePath, message } = error as {
        instancePath?: string;
        message: string;
      };
      return `  ${instancePath || '/'}: ${message}`;
    })
    .join('\n');
}

/**
 * Validate an already-parsed object against the lifecycle config schema.
 * Throws with a path-annotated message on any violation. Exported for tests
 * and callers that have the object in hand (e.g. embedded config).
 */
export function parseLifecycleConfig(raw: unknown): LifecycleConfig {
  if (!Value.Check(LifecycleConfigSchema, raw)) {
    throw new Error(
      `Invalid issue-lifecycle profiles config:\n${formatErrors(raw)}`,
    );
  }
  return raw;
}

/**
 * Load and validate a lifecycle profiles config from a JSON file path.
 * Returns the empty config when `path` is undefined (config is optional).
 * Throws on unreadable file, invalid JSON, or schema violation.
 */
export function loadLifecycleConfig(path: string | undefined): LifecycleConfig {
  if (!path) return EMPTY_LIFECYCLE_CONFIG;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `Could not read issue-lifecycle profiles config at ${path}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Profiles config at ${path} is not valid JSON: ${(err as Error).message}`,
    );
  }

  return parseLifecycleConfig(parsed);
}

/** Resolve a single step's config, defaulting to an empty step. */
export function stepConfig(
  config: LifecycleConfig,
  step: LifecycleStepName,
): StepConfig {
  return config[step] ?? {};
}
