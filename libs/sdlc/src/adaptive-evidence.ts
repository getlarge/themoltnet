import { type AdaptiveReport, findingKey } from '@moltnet/adaptive-review';

import type { ReviewResult, Revision } from './contracts.js';

/** Persist alongside review dispatch, including the review-specific policy snapshot. */
export interface AdaptiveReviewBinding {
  revision: Revision;
  repository: string;
  pr: number;
  correlationId: string;
  reviewPolicyDigest: string;
  runtimeSha: string;
}

/** Consume full internal reports, not the public inline-comment projection. */
export function adaptiveReviewEvidence(
  report: AdaptiveReport,
  binding: AdaptiveReviewBinding,
): Record<string, ReviewResult> | undefined {
  if (
    report.version !== 1 ||
    report.repo.toLowerCase() !== binding.repository.toLowerCase() ||
    report.pr !== binding.pr ||
    report.base !== binding.revision.base ||
    report.head !== binding.revision.head ||
    report.correlationId !== binding.correlationId ||
    report.policyDigest !== binding.reviewPolicyDigest ||
    report.runtimeSha !== binding.runtimeSha
  )
    return undefined;
  if (
    new Set(report.results.map((lane) => lane.lane)).size !==
    report.results.length
  )
    throw new Error('Duplicate review lane evidence');
  return Object.fromEntries(
    report.results
      .filter((lane) => lane.status !== 'screened')
      .map((lane) => {
        const findings = [
          ...lane.findings.map((finding) => findingKey(finding)),
          ...(lane.privateFindingIds ?? []),
        ].map((id) => ({
          id,
          origin: 'unknown' as const,
          disposition: 'open' as const,
        }));
        const incomplete =
          report.gaps.length > 0 || Boolean(lane.unclear?.length);
        const status = incomplete
          ? 'incomplete'
          : lane.status === 'clear'
            ? 'passed'
            : lane.status === 'concern'
              ? 'failed'
              : 'incomplete';
        return [lane.lane, { revision: binding.revision, status, findings }];
      }),
  );
}
