import { type Static, Type } from 'typebox';

import type { LaneResult } from './lane.js';
import type { PreviousFinding } from './threads.js';

export const PRIOR_FINDING_LIMIT = 20;

export const PriorFindingOutcomeSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 1000 }),
    status: Type.Union([
      Type.Literal('still_present'),
      Type.Literal('fixed'),
      Type.Literal('incorrect'),
      Type.Literal('not_checked'),
    ]),
    explanation: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
);
export const PriorFindingReviewSchema = Type.Object(
  {
    ...PriorFindingOutcomeSchema.properties,
    lane: Type.Union([
      Type.Literal('tests'),
      Type.Literal('conventions'),
      Type.Literal('blast-radius'),
      Type.Literal('performance'),
    ]),
    path: Type.String({ minLength: 1 }),
    url: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type PriorFindingOutcome = Static<typeof PriorFindingOutcomeSchema>;
export interface PriorFindingReview extends PriorFindingOutcome {
  lane: PreviousFinding['lane'];
  path: string;
  url: string;
}

/** Keep the model's historical context bounded; retain overflow in the report. */
export function focusedHistory(
  previous: readonly PreviousFinding[],
  lane: string,
): PreviousFinding[] {
  return previous
    .filter((finding) => finding.lane === lane)
    .slice(0, PRIOR_FINDING_LIMIT);
}

/** Missing output, disabled/screened lanes and failures never establish a fix. */
export function accountForPriorFindings(
  previous: readonly PreviousFinding[],
  results: readonly LaneResult[],
): PriorFindingReview[] {
  return previous
    .filter((finding) => !finding.isResolved)
    .map((finding) => {
      const result = results.find((item) => item.lane === finding.lane);
      const selected = focusedHistory(previous, finding.lane).some(
        (item) => item.key === finding.key,
      );
      const assessment =
        result &&
        result.status !== 'failed' &&
        result.status !== 'screened' &&
        selected
          ? result.priorFindingOutcomes?.find(
              (item) => item.key === finding.key,
            )
          : undefined;
      return {
        key: finding.key,
        lane: finding.lane,
        path: finding.path,
        url: finding.url,
        status: assessment?.status ?? 'not_checked',
        explanation:
          assessment?.explanation ??
          (!result
            ? 'This lane is not enabled in the current review.'
            : result.status === 'screened'
              ? 'The classifier did not select this lane.'
              : result.status === 'failed'
                ? 'The lane failed before producing a valid assessment.'
                : !selected
                  ? 'Outside the bounded prior-finding context for this run.'
                  : 'The reviewer did not return an assessment for this finding.'),
      };
    });
}
