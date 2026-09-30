import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

import type { ActionEnv } from './config.js';

/** Version of the `prepared` payload; `review` refuses any other. */
export const PREPARED_VERSION = 1;

/** One line with something on it: values end up in `name=value` outputs. */
const NonEmpty = Type.String({ pattern: '^[^\\r\\n]*\\S[^\\r\\n]*$' });

/**
 * Everything `review` and the workers need from `prepare`, passed between
 * jobs as one JSON output so callers forward a single value. The one schema
 * both writes and checks it.
 */
export const PreparedReviewSchema = Type.Object(
  {
    v: Type.Literal(PREPARED_VERSION),
    /** `review` refuses a pull request the gate turned away. */
    eligible: Type.Boolean(),
    pr: Type.Integer({ minimum: 1 }),
    baseSha: Type.String({ pattern: '^[0-9a-f]{40}$' }),
    headSha: Type.String({ pattern: '^[0-9a-f]{40}$' }),
    correlationId: Type.String({
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    }),
    /** `GITHUB_RUN_ATTEMPT` of `prepare`; a later attempt must re-run it. */
    runAttempt: Type.Integer({ minimum: 1 }),
    profiles: Type.Object(
      { default: NonEmpty, coverage: NonEmpty, docsCheck: NonEmpty },
      { additionalProperties: false },
    ),
    /** Distinct profiles: one drain worker each. */
    workerProfiles: Type.Array(NonEmpty, { minItems: 1, uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type PreparedReview = Static<typeof PreparedReviewSchema>;

/** A `prepared` value `review` cannot use; the message says what to fix. */
export class PreparedReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreparedReviewError';
  }
}

/**
 * Parses and checks the `prepared` output: the version, the schema, and that
 * every stage profile has a worker.
 */
export function parsePreparedReview(raw: string): PreparedReview {
  if (!raw.trim()) {
    throw new PreparedReviewError(
      "step: review needs the prepare payload: set prepared to the prepare step's prepared output",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new PreparedReviewError('prepared is not JSON');
  }
  const version = (value as { v?: unknown } | null)?.v;
  if (version !== PREPARED_VERSION) {
    throw new PreparedReviewError(
      `prepared payload version '${String(version)}' is not supported (expected ${PREPARED_VERSION}): run prepare and review with the same action version`,
    );
  }
  if (!Value.Check(PreparedReviewSchema, value)) {
    const problems = [...Value.Errors(PreparedReviewSchema, value)]
      .slice(0, 5)
      .map((error) => error.instancePath || '(root)');
    throw new PreparedReviewError(
      `prepared review has missing or invalid: ${[...new Set(problems)].join(' ')}`,
    );
  }
  const unserved = Object.values(value.profiles).filter(
    (profile) => !value.workerProfiles.includes(profile),
  );
  if (unserved.length > 0) {
    throw new PreparedReviewError(
      `prepared review has no worker for profiles: ${unserved.join(', ')}`,
    );
  }
  return value;
}

function isGitWorkTree(): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * `step: review`, first command: checks `prepared` and the inputs, then
 * writes the step outputs the later steps use.
 */
export function runCheckPreparedCli(
  env: ActionEnv,
  isWorkTree: () => boolean = isGitWorkTree,
): void {
  const prepared = parsePreparedReview(env.PREPARED ?? '');
  if (!prepared.eligible) {
    throw new PreparedReviewError(
      "the prepared review is not eligible; gate the review job on the prepare skip output being 'false'",
    );
  }
  // "Re-run failed jobs" re-runs review without prepare or the workers: the
  // tasks would wait for workers that are not coming.
  const attempt = env.GITHUB_RUN_ATTEMPT;
  if (attempt && String(prepared.runAttempt) !== attempt) {
    throw new PreparedReviewError(
      `this is run attempt ${attempt}, but prepare ran in attempt ${prepared.runAttempt}, so no workers run for this review: re-run all jobs, not only failed ones`,
    );
  }
  const missing = ['TEAM_ID', 'DIARY_ID'].filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new PreparedReviewError(
      `step: review is missing inputs: ${missing.join(' ')}`,
    );
  }
  if (Boolean(env.APP_ID?.trim()) !== Boolean(env.APP_KEY?.trim())) {
    throw new PreparedReviewError('set app-id and app-private-key together');
  }
  if (!isWorkTree()) {
    throw new PreparedReviewError(
      'check out the repository at the base revision before step: review',
    );
  }
  const output = env.GITHUB_OUTPUT;
  if (!output) throw new PreparedReviewError('GITHUB_OUTPUT is required');
  appendFileSync(
    output,
    [
      `pr-number=${prepared.pr}`,
      `base-sha=${prepared.baseSha}`,
      `head-sha=${prepared.headSha}`,
      `correlation-id=${prepared.correlationId}`,
      `profile=${prepared.profiles.default}`,
      `coverage-profile=${prepared.profiles.coverage}`,
      `docs-check-profile=${prepared.profiles.docsCheck}`,
    ]
      .map((line) => `${line}\n`)
      .join(''),
  );
}
