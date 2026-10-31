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
  action?: string;
  existingFindingKey?: string;
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
  /** URLs read from the reviewer's existing GitHub threads. */
  links?: ReadonlyMap<string, string>;
}

/** Where a finding came from: the run and the review tasks that raised it. */
export interface FindingSource {
  runUrl: string;
  correlationId: string;
}

/** Ordinary summary limit; explicit references remain visible for comparison. */
export const MAX_LISTED_FINDINGS = 30;

/**
 * The identity of a finding across runs. A finding repeated at the same
 * lane, side, line, and path is the same thread and is not posted twice; a
 * finding with a validated reference reuses its earlier thread identity even
 * when the reviewer cites another changed line.
 */
export function findingKey(
  finding: Pick<
    InlineFinding,
    'lane' | 'path' | 'side' | 'line' | 'existingFindingKey'
  >,
): string {
  if (finding.existingFindingKey) return finding.existingFindingKey;
  return `${finding.lane}:${finding.side}:${finding.line}:${encodeURIComponent(finding.path)}`;
}

/** Findings that cite a line. */
export function inlineFindings(
  results: readonly LaneResult[],
): InlineFinding[] {
  return results.flatMap((result) =>
    result.findings.flatMap((finding) =>
      finding.path && finding.side && finding.line
        ? [
            {
              lane: result.lane,
              path: finding.path,
              side: finding.side,
              line: finding.line,
              concern: finding.concern,
              ...(finding.existingFindingKey
                ? { existingFindingKey: finding.existingFindingKey }
                : {}),
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
): ({ key: string } & Partial<FindingSource>) | undefined {
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
  const runUrl = value('run', decodeURI);
  const correlationId = value('correlation', decodeURIComponent);
  return {
    key,
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
    `${ADAPTIVE_FINDING_MARKER}${findingKey(finding)}${origin} -->`,
    `**Adaptive review · ${finding.lane}**`,
    '',
    shorten(finding.concern, 2000),
    ...(finding.action
      ? ['', `Suggested action: ${shorten(finding.action, 2000)}`]
      : []),
    '',
    '_Assess this finding; fix confirmed problems or explain why no change is needed._',
  ].join('\n');
}

function findingCount(
  total: number,
  threads: ThreadSummary | undefined,
  hasReferences: boolean,
): string {
  if (total === 0) return 'Findings: 0. Nothing needs fixing from this run.';
  if (!threads) return `Findings: ${total}.`;
  const listed = total - threads.posted - threads.existing;
  const parts = [
    `${threads.posted} posted as new review threads`,
    `${threads.existing} ${hasReferences ? 'linked to open threads from earlier runs' : 'already open from an earlier run'}`,
    ...(listed > 0 ? [`${listed} listed below`] : []),
  ];
  return `Findings: ${total} (${parts.join(', ')}). Assess each finding; fix confirmed problems or explain why no change is needed.${hasReferences ? ' Current findings referencing earlier threads are also shown below for comparison.' : ''}`;
}

/** Coverage refers to selected investigations, never to screened-out lanes. */
export function hasIncompleteCoverage(report: AdaptiveReport): boolean {
  return (
    report.gaps.length > 0 ||
    Boolean(
      report.priorFindingOutcomes?.some(
        (item) => item.status === 'not_checked',
      ),
    ) ||
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
    '## Adaptive review: stale',
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
      ? '## Adaptive review: incomplete coverage'
      : '## Adaptive review',
    '',
    `${report.mode === 'shadow' ? 'All enabled lanes were selected for investigation. Selection does not imply complete coverage; see results and gaps below.' : 'Classifier-selected investigations.'} Head \`${report.head.slice(0, 7)}\` · [workflow run](${runUrl}).`,
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
      route.reason === 'screened' ? 'screened, not investigated' : route.reason;
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
    (result) => result.status === 'concern',
  );
  lines.push(
    '',
    report.priorFindingOutcomes?.length &&
      concerns.every((result) => !result.findings.length)
      ? 'Inline findings: 0. See the prior-finding assessments below.'
      : findingCount(
          concerns.reduce((count, result) => count + result.findings.length, 0),
          threads,
          concerns.some((result) =>
            result.findings.some((finding) =>
              Boolean(finding.existingFindingKey),
            ),
          ),
        ),
  );
  let listed = 0;
  let omitted = 0;
  if (concerns.length) {
    lines.push('', 'Investigated concerns:');
    for (const result of concerns) {
      lines.push(`- **${result.lane}**: ${shorten(result.summary, 240)}`);
      for (const finding of result.findings) {
        const key =
          finding.path && finding.side && finding.line
            ? findingKey({
                lane: result.lane,
                path: finding.path,
                side: finding.side,
                line: finding.line,
                existingFindingKey: finding.existingFindingKey,
              })
            : undefined;
        // A reference is the model's match, not proof of equivalent concerns.
        // Keep the current finding visible even when its thread is reused.
        if (key && threads?.keys.has(key) && !finding.existingFindingKey)
          continue;
        if (listed >= MAX_LISTED_FINDINGS && !finding.existingFindingKey) {
          omitted += 1;
          continue;
        }
        listed += 1;
        const threadUrl =
          finding.existingFindingKey &&
          threads?.links?.get(finding.existingFindingKey);
        lines.push(
          `  - ${shorten(finding.path, 120)}${finding.line ? `:${finding.line}` : ''}${finding.side === 'old' ? ' (old)' : ''}: ${shorten(finding.concern, 240)}${key && threads?.resolved.has(key) ? (finding.existingFindingKey ? ' _(the referenced earlier thread was resolved)_' : ' _(an earlier thread on this line was resolved)_') : ''}${threadUrl ? ` · [Referenced earlier thread](${threadUrl})` : ''}`,
        );
      }
    }
    if (omitted > 0)
      lines.push(
        `- ${omitted} more findings are not shown here; the [workflow run](${runUrl}) has the full report.`,
      );
  }
  lines.push(...renderPriorFindings(report));
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
    report.routing.routes.some((route) => !route.run)
      ? '_Advisory review. A screened lane was not investigated. Comment `/review` to investigate every lane._'
      : '_Advisory review._',
  );
  if (report.spend) lines.push('', formatWorkflowSpend(report.spend));
  return lines.join('\n');
}

function priorText(value: string, limit: number): string {
  return shorten(value, limit)
    .replace(/\r?\n/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;')
    .replace(/[\\`*_[\]~]/g, '\\$&');
}

function renderPriorFindings(report: AdaptiveReport): string[] {
  const outcomes = report.priorFindingOutcomes ?? [];
  if (!outcomes.length) return [];
  const labels = {
    still_present: 'Still present',
    fixed: 'Fixed',
    incorrect: 'Earlier finding was wrong',
    not_checked: 'Not checked / uncertain',
  };
  const lines = [
    '',
    '### Previous open findings',
    '',
    'Assessments for this head, based on threads open when review started. These are reviewer conclusions; GitHub threads are not automatically resolved.',
    '',
    Object.entries(labels)
      .map(
        ([status, label]) =>
          `${label}: ${outcomes.filter((item) => item.status === status).length}`,
      )
      .join(' · '),
    '',
  ];
  for (const item of outcomes.slice(0, 40)) {
    const url = /^https:\/\/[^\s<>]+$/.test(item.url)
      ? item.url.replace(/\(/g, '%28').replace(/\)/g, '%29')
      : undefined;
    lines.push(
      `- **${labels[item.status]}** · ${item.lane} · ${priorText(item.path, 120)}${url ? ` · [Earlier thread](${url})` : ''}: ${priorText(item.explanation, 600)}`,
    );
  }
  if (outcomes.length > 40)
    lines.push(
      `- ${outcomes.length - 40} more individual assessments are in the workflow report; the counts above include them.`,
    );
  return lines;
}
