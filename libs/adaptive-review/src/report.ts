import { createHash } from 'node:crypto';

import { shorten } from '@moltnet/docs-impact-review';
import { formatWorkflowSpend } from '@moltnet/tasks';

import type { Lane } from './policy.js';
import type { AdaptiveReport, LaneResult } from './workflow.js';

export const ADAPTIVE_REVIEW_MARKER = '<!-- moltnet:adaptive-review -->';
/** Prefix of the hidden marker that identifies a finding's review thread. */
export const ADAPTIVE_FINDING_MARKER = '<!-- moltnet:adaptive-finding ';

/** A finding a review thread can anchor to: a cited line on a known side. */
export interface InlineFinding {
  lane: Lane;
  path: string;
  side: 'old' | 'new';
  line: number;
  concern: string;
  problemId?: string;
  action?: string;
}

/** How the findings were published, for the summary comment. */
export interface ThreadSummary {
  /** Threads opened by this run. */
  posted: number;
  /** Findings that already had a thread from an earlier run. */
  existing: number;
  /** Keys of findings with an open thread, posted now or earlier. */
  keys: ReadonlySet<string>;
  /**
   * Keys whose earlier thread was resolved. The finding is listed in the
   * summary instead of reopening a thread the author already closed.
   */
  resolved: ReadonlySet<string>;
}

/** Where a finding came from: the run and the review tasks that raised it. */
export interface FindingSource {
  runUrl: string;
  correlationId: string;
}

/** The most findings the summary lists before pointing at the run. */
export const MAX_LISTED_FINDINGS = 30;

/** Problem identity ignores line movement and lane; explicit root-cause IDs survive rewording. */
export function findingKey(
  finding: Pick<InlineFinding, 'path' | 'concern'> & Partial<InlineFinding>,
): string {
  const problem =
    finding.problemId?.trim() || finding.concern.trim().replace(/\s+/g, ' ');
  return `v2:${createHash('sha256')
    .update(JSON.stringify([finding.path, problem]))
    .digest('hex')}`;
}

/** Findings that cite a line. Security findings stay in the review tasks. */
export function inlineFindings(
  results: readonly LaneResult[],
): InlineFinding[] {
  return results
    .filter((result) => result.lane !== 'security')
    .flatMap((result) =>
      result.findings.flatMap((finding) =>
        finding.path && finding.side && finding.line
          ? [
              {
                lane: result.lane,
                path: finding.path,
                side: finding.side,
                line: finding.line,
                concern: finding.concern,
                ...(finding.problemId ? { problemId: finding.problemId } : {}),
                ...(finding.action ? { action: finding.action } : {}),
              },
            ]
          : [],
      ),
    );
}

/** Reads the key and source back from a thread this reviewer posted. */
export function parseFindingMarker(
  body: string,
): ({ key: string; lane?: string } & Partial<FindingSource>) | undefined {
  if (!body.startsWith(ADAPTIVE_FINDING_MARKER)) return undefined;
  const end = body.indexOf(' -->');
  if (end <= ADAPTIVE_FINDING_MARKER.length) return undefined;
  const [key, ...fields] = body
    .slice(ADAPTIVE_FINDING_MARKER.length, end)
    .split(' ');
  if (!key) return undefined;
  const value = (name: string, decode: (raw: string) => string) => {
    const raw = fields
      .find((field) => field.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    try {
      return raw ? decode(raw) : undefined;
    } catch {
      return undefined;
    }
  };
  const lane = value('lane', decodeURIComponent);
  const runUrl = value('run', decodeURI);
  const correlationId = value('correlation', decodeURIComponent);
  return {
    key,
    ...(lane ? { lane } : {}),
    ...(runUrl ? { runUrl } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}

/** Reads the finding key back from a review comment this reviewer posted. */
export function postedFindingKey(body: string): string | undefined {
  return parseFindingMarker(body)?.key;
}

/** The body of one review thread. Every thread asks for a fix or a reason. */
export function renderFindingComment(
  finding: InlineFinding,
  source?: FindingSource,
): string {
  const origin = source
    ? ` run=${encodeURI(source.runUrl)} correlation=${encodeURIComponent(source.correlationId)}`
    : '';
  return [
    `${ADAPTIVE_FINDING_MARKER}${findingKey(finding)} lane=${finding.lane}${origin} -->`,
    `**Adaptive review · ${finding.lane}**`,
    '',
    shorten(finding.concern, 2000),
    ...(finding.action
      ? ['', `Suggested action: ${shorten(finding.action, 2000)}`]
      : []),
    '',
    '_Fix it, or resolve this thread with a short reason._',
  ].join('\n');
}

function findingCount(
  total: number,
  threads: ThreadSummary | undefined,
): string {
  if (total === 0) return 'Findings: 0. Nothing needs fixing from this run.';
  if (!threads) return `Findings: ${total}.`;
  const listed = total - threads.posted - threads.existing;
  const parts = [
    `${threads.posted} posted as new review threads`,
    `${threads.existing} already open from an earlier run`,
    ...(listed > 0 ? [`${listed} listed below`] : []),
  ];
  return `Findings: ${total} (${parts.join(', ')}). Fix each one, or resolve its thread with a reason.`;
}

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
  threads?: ThreadSummary,
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
  lines.push(
    '',
    findingCount(
      concerns.reduce((count, result) => count + result.findings.length, 0),
      threads,
    ),
  );
  let listed = 0;
  if (concerns.length) {
    lines.push('', 'Investigated concerns:');
    for (const result of concerns) {
      lines.push(`- **${result.lane}**: ${shorten(result.summary, 240)}`);
      for (const finding of result.findings) {
        const key =
          finding.path && finding.side && finding.line
            ? findingKey({
                path: finding.path,
                concern: finding.concern,
                problemId: finding.problemId,
              })
            : undefined;
        if (key && threads?.keys.has(key)) continue;
        listed += 1;
        if (listed > MAX_LISTED_FINDINGS) continue;
        lines.push(
          `  - ${shorten(finding.path, 120)}${finding.line ? `:${finding.line}` : ''}${finding.side === 'old' ? ' (old)' : ''}: ${shorten(finding.concern, 240)}${key && threads?.resolved.has(key) ? ' _(thread resolved; current finding still requires verification)_' : ''}`,
        );
      }
    }
    if (listed > MAX_LISTED_FINDINGS)
      lines.push(
        `- ${listed - MAX_LISTED_FINDINGS} more findings are not shown here; the [workflow run](${runUrl}) has the full report.`,
      );
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
