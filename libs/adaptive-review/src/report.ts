import type { AdaptiveReport } from './workflow.js';

export const ADAPTIVE_REVIEW_MARKER = '<!-- moltnet:adaptive-review -->';

function plain(value: string, max = 240): string {
  const flat = value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[[\]]/g, (bracket) => `\\${bracket}`)
    .replace(/@(?=[A-Za-z0-9_-])/g, '@\u200b')
    .replace(/#(?=\d)/g, '#\u200b')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function renderAdaptiveComment(
  report: AdaptiveReport,
  runUrl: string,
): string {
  const lines = [
    ADAPTIVE_REVIEW_MARKER,
    '## Experimental adaptive review',
    '',
    `${report.mode === 'shadow' ? 'Shadow run: every enabled lane was investigated.' : 'Classifier-selected investigations.'} Head \`${report.head.slice(0, 7)}\` · [workflow run](${runUrl}).`,
    '',
    '| Lane | Jev concern | Investigation |',
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
    `Jev scores (0–3): code complexity ${complexity === null ? 'unavailable' : complexity.toFixed(1)}; review effort ${effort === null ? 'unavailable' : effort.toFixed(1)}. These describe screening, not review findings.`,
  );
  const concerns = report.results.filter(
    (result) => result.status === 'concern' && result.lane !== 'security',
  );
  if (concerns.length) {
    lines.push('', 'Investigated concerns:');
    for (const result of concerns) {
      lines.push(`- **${result.lane}**: ${plain(result.summary)}`);
      for (const finding of result.findings.slice(0, 2)) {
        lines.push(
          `  - ${plain(finding.path, 120)}${finding.line ? `:${finding.line}` : ''}: ${plain(finding.concern)}`,
        );
      }
    }
  }
  const security = report.results.find((result) => result.lane === 'security');
  if (security?.status === 'concern' || security?.status === 'unclear') {
    lines.push(
      '',
      'Security investigation needs specialist follow-up. Details remain in the team-scoped review tasks.',
    );
  }
  const gaps = [
    ...report.gaps,
    ...report.results
      .filter(
        (result) => result.status === 'failed' || result.status === 'unclear',
      )
      .map((result) => `${result.lane}: ${result.summary}`),
  ];
  if (gaps.length) {
    lines.push('', 'Not fully assessed:');
    for (const gap of gaps.slice(0, 8)) lines.push(`- ${plain(gap)}`);
    if (gaps.length > 8)
      lines.push(`- …and ${gaps.length - 8} more in the workflow report.`);
  }
  lines.push(
    '',
    '_This is an advisory experiment. A screened lane has not been verified._',
  );
  return lines.join('\n');
}
