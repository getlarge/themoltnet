/** Input and runtime limits for one review. */
export interface Budgets {
  /** Model-facing diff for the extraction stage, source and docs together. */
  diffTotalBytes: number;
  /** One file's patch; longer patches are cut at a line boundary. */
  diffPerFileBytes: number;
  /**
   * Part of `diffTotalBytes` that changed docs fill before source does, so a
   * large source change cannot push the pull request's own docs out.
   */
  diffDocsReserveBytes: number;
  /** Documentation diff passed to the coverage stage. */
  docsDiffBytes: number;
  docExcerptBytes: number;
  maxDocs: number;
  manifestLines: number;
  maxDocsHunks: number;
  docsHunkBytes: number;
  /** Server-enforced running timeout of each stage task. */
  stageRunningTimeoutSec: number;
}

/**
 * Initial budgets sized for ~24k input tokens per stage (≈4 bytes/token):
 * extraction gets the diff; coverage gets docs diff plus six excerpts.
 */
export const DEFAULT_BUDGETS: Readonly<Budgets> = Object.freeze({
  diffTotalBytes: 64_000,
  diffPerFileBytes: 12_000,
  diffDocsReserveBytes: 16_000,
  docsDiffBytes: 16_000,
  docExcerptBytes: 8_000,
  maxDocs: 6,
  manifestLines: 150,
  maxDocsHunks: 12,
  docsHunkBytes: 1_500,
  // Sized for a 2–3 minute review: coverage on a larger PR can need more than
  // 90 s, and running out yields an honest `incomplete`, never a clean result.
  stageRunningTimeoutSec: 120,
});

/** Budgets a repository may set in its configuration file. */
export const CONFIGURABLE_BUDGETS = [
  'diffTotalBytes',
  'diffPerFileBytes',
  'diffDocsReserveBytes',
  'docsDiffBytes',
  'docExcerptBytes',
  'maxDocs',
  'maxDocsHunks',
  'stageRunningTimeoutSec',
] as const satisfies ReadonlyArray<keyof Budgets>;
export type ConfigurableBudget = (typeof CONFIGURABLE_BUDGETS)[number];

/**
 * Accepted range per configurable budget. Upper bounds keep a stage within
 * a model's context and the review job's timeout: two chained stages of at
 * most 300 s dispatch plus 240 s running stay under the 20-minute job.
 */
export const BUDGET_LIMITS: Readonly<
  Record<ConfigurableBudget, { minimum: number; maximum: number }>
> = Object.freeze({
  diffTotalBytes: { minimum: 8_000, maximum: 256_000 },
  diffPerFileBytes: { minimum: 1_000, maximum: 64_000 },
  diffDocsReserveBytes: { minimum: 0, maximum: 128_000 },
  docsDiffBytes: { minimum: 1_000, maximum: 64_000 },
  docExcerptBytes: { minimum: 1_000, maximum: 32_000 },
  maxDocs: { minimum: 1, maximum: 20 },
  maxDocsHunks: { minimum: 1, maximum: 50 },
  stageRunningTimeoutSec: { minimum: 30, maximum: 240 },
});

/** Defaults, then repository configuration, then caller overrides. */
export function resolveBudgets(
  ...layers: ReadonlyArray<Partial<Budgets> | undefined>
): Budgets {
  return Object.assign({}, DEFAULT_BUDGETS, ...layers) as Budgets;
}
