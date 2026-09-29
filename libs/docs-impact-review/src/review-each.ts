import { ReviewConfigError, type ReviewConfigSource } from './review-config.js';
import type { DocsImpactReport } from './types.js';
import { failedReport } from './workflow.js';

/** What is known about a pull request so far; filled in as its review runs. */
export interface ReviewTarget {
  repo: string;
  pr: number;
  baseRevision: string;
  headRevision: string;
  configSource?: ReviewConfigSource;
  /** What the review is doing, named when it fails (`fetch`, `config`…). */
  phase?: string;
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
  log: (message: string) => void = (message) =>
    process.stderr.write(`${message}\n`),
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
      const message = error instanceof Error ? error.message : String(error);
      const detail = target.phase
        ? `failed during ${target.phase}: ${message}`
        : message;
      log(`[pr ${pr}] ${detail}`);
      report = failedReport(
        target,
        error instanceof ReviewConfigError ? error.source : target.configSource,
        detail,
      );
    }
    if (!report) continue;
    reports.push(report);
    // Writing one report (e.g. to --out) must not stop the others.
    try {
      onReport(report);
    } catch (error) {
      log(
        `[pr ${pr}] could not write the report: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return reports;
}
