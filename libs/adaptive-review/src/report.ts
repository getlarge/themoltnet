import { shorten } from '@moltnet/docs-impact-review';
import { formatWorkflowSpend } from '@moltnet/tasks';

import type { AdaptiveReport } from './workflow.js';

export const ADAPTIVE_REVIEW_MARKER = '<!-- moltnet:adaptive-review -->';

/** Coverage refers to selected investigations, never to screened-out lanes. */
export function hasIncompleteCoverage(report: AdaptiveReport): boolean {
  return (
    report.gaps.length > 0 ||
    report.results.some(
      (result) =>
        result.status === 'failed' ||
        result.status === 'unclear' ||
        Boolean(result.unclear?.length),
    ) ||
    report.routing.routes.some(
      (route) =>
        route.run &&
        !report.results.some(
          (result) =>
            result.lane === route.lane && result.status !== 'screened',
        ),
    )
  );
}

/** Replaces a result whose pull request moved while it was being published. */
export function renderAdaptiveStale(
  report: Pick<AdaptiveReport, 'head' | 'base'>,
  current: { head: string; base: string },
  runUrl: string,
): string {
  const moved =
    current.head === report.head
      ? `base now points at \`${current.base.slice(0, 7)}\``
      : `head now points at \`${current.head.slice(0, 7)}\``;
  return [
    ADAPTIVE_REVIEW_MARKER,
    '## Experimental adaptive review: stale',
    '',
    `Reviewed head \`${report.head.slice(0, 7)}\` · [workflow run](${runUrl}).`,
    '',
    `The pull request ${moved}, so this result was not published as current. A review of the new revision replaces this notice.`,
  ].join('\n');
}

export function renderAdaptiveComment(
  report: AdaptiveReport,
  runUrl: string,
): string {
  const lines = [
    ADAPTIVE_REVIEW_MARKER,
    hasIncompleteCoverage(report)
      ? '## Experimental adaptive review: incomplete coverage'
      : '## Experimental adaptive review',
    '',
    `${report.mode === 'shadow' ? 'Shadow run: every enabled lane was selected for investigation.' : 'Classifier-selected investigations.'} Head \`${report.head.slice(0, 7)}\` · [workflow run](${runUrl}).`,
    '',
    '| Lane | Classifier concern | Investigation |',
    '| --- | ---: | --- |',
  ];
  for (const route of report.routing.routes) {
    const result = report.results.find((item) => item.lane === route.lane);
    const probability =
      route.probability === null
        ? 'unavailable'
        : `${Math.round(route.probability * 100)}%`;
    const routing =
      route.reason === 'screened' ? 'screened, not verified' : route.reason;
    lines.push(
      `| ${route.lane} | ${probability} (${routing}) | ${result?.status ?? 'failed'} |`,
    );
  }
  const complexity = report.routing.scores['code-complexity'];
  const effort = report.routing.scores['review-effort'];
  lines.push(
    '',
    `Classifier scores (0–3): code complexity ${complexity === null ? 'unavailable' : complexity.toFixed(1)}; review effort ${effort === null ? 'unavailable' : effort.toFixed(1)}. These describe screening, not review findings.`,
  );
  const concerns = report.results.filter(
    (result) => result.status === 'concern' && result.lane !== 'security',
  );
  if (concerns.length) {
    lines.push('', 'Investigated concerns:');
    for (const result of concerns) {
      lines.push(`- **${result.lane}**: ${shorten(result.summary, 240)}`);
      for (const finding of result.findings.slice(0, 2)) {
        lines.push(
          `  - ${shorten(finding.path, 120)}${finding.line ? `:${finding.line}` : ''}${finding.side === 'old' ? ' (old)' : ''}: ${shorten(finding.concern, 240)}`,
        );
      }
    }
  }
  const security = report.results.find((result) => result.lane === 'security');
  if (security && ['concern', 'unclear', 'failed'].includes(security.status)) {
    lines.push(
      '',
      'Security investigation needs specialist follow-up. Details remain in the team-scoped review tasks.',
    );
  }
  const gaps = [
    ...report.gaps,
    ...report.results
      .filter(
        (result) =>
          result.status === 'failed' ||
          result.status === 'unclear' ||
          Boolean(result.unclear?.length),
      )
      .flatMap((result) => [
        `${result.lane}: ${result.summary}`,
        ...(result.unclear ?? []).map((item) => `${result.lane}: ${item}`),
      ]),
  ];
  if (gaps.length) {
    lines.push('', 'Not fully assessed:');
    for (const gap of gaps.slice(0, 8)) lines.push(`- ${shorten(gap, 240)}`);
    if (gaps.length > 8)
      lines.push(`- …and ${gaps.length - 8} more in the workflow report.`);
  }
  lines.push(
    '',
    '_This is an advisory experiment. A screened lane has not been verified._',
  );
  if (report.spend) lines.push('', formatWorkflowSpend(report.spend));
  return lines.join('\n');
}
