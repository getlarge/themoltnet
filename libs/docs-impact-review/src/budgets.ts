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

/** Share of `diffTotalBytes` reserved for changed docs unless configured. */
export const DEFAULT_DOCS_RESERVE_SHARE = 0.25;

/**
 * Initial budgets sized for ~24k input tokens per stage (≈4 bytes/token):
 * extraction gets the diff; coverage gets docs diff plus six excerpts. The
 * docs reserve has no fixed default: it follows `diffTotalBytes`.
 */
export const DEFAULT_BUDGETS: Readonly<Omit<Budgets, 'diffDocsReserveBytes'>> =
  Object.freeze({
    diffTotalBytes: 64_000,
    diffPerFileBytes: 12_000,
    docsDiffBytes: 16_000,
    docExcerptBytes: 8_000,
    maxDocs: 6,
    manifestLines: 150,
    maxDocsHunks: 12,
    docsHunkBytes: 1_500,
    // Sized for a 2–3 minute review: coverage on a larger PR can need more
    // than 90 s, and running out yields an honest `incomplete`, never a clean
    // result.
    stageRunningTimeoutSec: 120,
  });

/** Budgets a repository may set in its configuration file. */
export type ConfigurableBudget =
  | 'diffTotalBytes'
  | 'diffPerFileBytes'
  | 'diffDocsReserveBytes'
  | 'docsDiffBytes'
  | 'docExcerptBytes'
  | 'maxDocs'
  | 'maxDocsHunks'
  | 'stageRunningTimeoutSec';

/**
 * Seconds of each review job left for checkout, ingest, polling, and the
 * comment once both chained stages used their dispatch and running limits.
 */
export const REVIEW_JOB_MARGIN_SEC = 240;

/**
 * Accepted range per configurable budget. Upper bounds keep a stage within
 * a model's context and the review job's timeout: two chained stages of at
 * most 300 s dispatch plus 180 s running take 16 minutes, leaving
 * `REVIEW_JOB_MARGIN_SEC` of the reusable workflow's 20-minute job (a test
 * holds the two together).
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
  stageRunningTimeoutSec: { minimum: 30, maximum: 180 },
});

/**
 * Defaults overlaid with the budgets a repository configured. A key set to
 * `undefined` keeps its default rather than erasing it. Without a configured
 * docs reserve, a quarter of the diff is reserved for changed docs.
 */
export function resolveBudgets(configured: Partial<Budgets> = {}): Budgets {
  const set = Object.fromEntries(
    Object.entries(configured).filter(([, value]) => value !== undefined),
  ) as Partial<Budgets>;
  const merged = { ...DEFAULT_BUDGETS, ...set };
  return {
    ...merged,
    diffDocsReserveBytes:
      set.diffDocsReserveBytes ??
      Math.floor(merged.diffTotalBytes * DEFAULT_DOCS_RESERVE_SHARE),
  };
}
