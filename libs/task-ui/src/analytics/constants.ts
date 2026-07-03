// Shared analytics UI constants.

/**
 * The high-friction classification thresholds. These mirror the backend rule
 * that computes `hurdles.highFrictionAttemptCount` (an attempt is "high
 * friction" when it exceeds either bound). Kept here as a single source so the
 * caption can't drift across components.
 *
 * NOTE: this duplicates a backend-owned rule. Once the analytics endpoint
 * surfaces the thresholds in the response (see the API coordination note),
 * replace these constants with the response-provided values.
 */
export const HIGH_FRICTION_TURNS = 8;
export const HIGH_FRICTION_FAILED_TOOL_CALLS = 3;

export const HIGH_FRICTION_CAPTION = `≥ ${HIGH_FRICTION_TURNS} turns or ≥ ${HIGH_FRICTION_FAILED_TOOL_CALLS} failed tool calls`;

/**
 * Rate → tone boundaries. A "good" rate (higher is better) is positive at/above
 * GOOD, caution down to CAUTION, negative below. A "bad" rate (lower is better)
 * inverts: positive at/below BAD_GOOD, caution up to BAD_CAUTION, negative above.
 */
export const RATE_TONE = {
  goodPositiveAt: 0.8,
  goodCautionAt: 0.5,
  badPositiveAt: 0.05,
  badCautionAt: 0.2,
} as const;
