import type { ReviewConfigSource } from './review-config.js';
import type { DocsImpactReport } from './types.js';
import { failedReport } from './workflow.js';

/** What is known about a pull request so far; filled in as its review runs. */
export interface ReviewTarget {
  repo: string;
  pr: number;
  baseRevision: string;
  headRevision: string;
  configSource?: ReviewConfigSource;
}

/**
 * Reviews pull requests one by one. A pull request that fails (metadata,
 * fetch, configuration, or the review itself) gets a failed report naming
 * the error, and the next one still runs. `review` returns nothing for a
 * dry run.
 */
export async function reviewEach(
  repo: string,
  prs: readonly number[],
  review: (target: ReviewTarget) => Promise<DocsImpactReport | undefined>,
  onReport: (report: DocsImpactReport) => void,
): Promise<DocsImpactReport[]> {
  const reports: DocsImpactReport[] = [];
  for (const pr of prs) {
    const target: ReviewTarget = {
      repo,
      pr,
      baseRevision: '',
      headRevision: '',
    };
    let report: DocsImpactReport | undefined;
    try {
      report = await review(target);
    } catch (error) {
      report = failedReport(
        target,
        target.configSource,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!report) continue;
    reports.push(report);
    onReport(report);
  }
  return reports;
}
