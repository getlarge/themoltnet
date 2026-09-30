import type { DocsImpactReport } from './types.js';

export const DOCS_IMPACT_COMMENT_MARKER = '<!-- moltnet:docs-impact-review -->';

/** The comment shows at most this many findings; the report keeps all. */
export const COMMENT_MAX_FINDINGS = 3;

/**
 * An error in the comment stays readable and far below GitHub's 65,536
 * character limit; the full text is in the run's report and log.
 */
const ERROR_TEXT_MAX = 1_000;

/** Comment-side cap for free text; validation only guards runaway output. */
export const COMMENT_TEXT_MAX = 280;

/**
 * Model-written text is published as the posting identity, so it must stay
 * one line of plain text:
 *
 * - whitespace collapses to single spaces, so no heading, list or reference
 *   definition can start;
 * - `[`, `]` and `!` before `[` are escaped, so no link or image forms, at
 *   any nesting;
 * - `@` mentions and `#123` or `owner/repo#123` references are broken with a
 *   zero-width space, so nobody is notified and nothing is backlinked;
 * - `<` and `>` are escaped, so no HTML or autolink.
 *
 * Each rule is one pass over the text with no backtracking.
 */
export function neutralize(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[[\]]/g, (bracket) => `\\${bracket}`)
    .replace(/@(?=[A-Za-z0-9_-])/g, '@\u200b')
    .replace(/#(?=\d)/g, '#\u200b')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function shorten(text: string, max = COMMENT_TEXT_MAX): string {
  const flat = neutralize(text);
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** A Markdown heading as plain text: `## Flags` → `Flags`. */
export function headingText(section: string): string {
  return neutralize(section.replace(/^#{1,6}\s+/, '').trim());
}

/** `48s`, `2m 48s`; sub-second durations round up to `1s`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** A repository path shown as code and linked at head; both escaped. */
function fileLink(report: DocsImpactReport, path: string): string {
  // encodeURIComponent leaves `(` and `)`, which would end the link.
  const target = path
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(/[()]/g, (char) =>
        char === '(' ? '%28' : '%29',
      ),
    )
    .join('/');
  return `[${codeSpan(path)}](https://github.com/${report.repo}/blob/${report.headRevision}/${target})`;
}

/**
 * Inline code that `text` cannot break out of: the fence is longer than any
 * backtick run inside, and newlines are flattened.
 */
export function codeSpan(text: string, max = Number.POSITIVE_INFINITY): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const flat =
    collapsed.length <= max
      ? collapsed
      : `${collapsed.slice(0, max - 1).trimEnd()}…`;
  const longest = Math.max(
    0,
    ...(flat.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = '`'.repeat(longest + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${flat}${pad}${fence}`;
}

/**
 * One concise PR comment body. Clean results stay on one line; a failed run
 * says so explicitly instead of looking like an empty clean result.
 */
export function renderComment(report: DocsImpactReport): string {
  const head = report.headRevision
    ? `head [\`${report.headRevision.slice(0, 7)}\`](https://github.com/${report.repo}/commit/${report.headRevision})`
    : 'head unknown';
  if (report.status === 'failed' || !report.outcome) {
    return [
      DOCS_IMPACT_COMMENT_MARKER,
      `**Docs impact: not reviewed** · ${head}`,
      '',
      `The review did not complete: ${codeSpan(report.error || 'unknown error', ERROR_TEXT_MAX)}. No judgment was made.`,
    ].join('\n');
  }
  const count = report.findings.length;
  const context = [
    `**Docs impact: ${report.outcome}**`,
    head,
    ...(count > 0 ? [`${count} finding${count === 1 ? '' : 's'}`] : []),
    `reviewed in ${formatDuration(report.timings.totalMs)}`,
  ];
  const lines = [DOCS_IMPACT_COMMENT_MARKER, context.join(' · ')];
  // A review without the repository's own configuration has no routing rules,
  // so it may miss docs the maintainers mapped; say so where it is read.
  if (report.config?.kind === 'default') {
    lines.push(
      '',
      '_No `.github/docs-impact-review.json` at the base revision: reviewed with the default configuration, without routing rules._',
    );
  } else if (report.config?.kind === 'file') {
    lines.push(
      '',
      `_Reviewed with the configuration in ${codeSpan(report.config.location)}, not the base revision's._`,
    );
  } else if (report.config?.kind === 'base') {
    lines.push('', `_Configuration: ${codeSpan(report.config.location)}._`);
  }
  // A doc the review says is missing does not exist at head yet.
  const missing = new Set(
    report.selectedDocs.filter((doc) => doc.missing).map((doc) => doc.path),
  );
  if (count > 0) {
    lines.push('');
    for (const finding of report.findings.slice(0, COMMENT_MAX_FINDINGS)) {
      const doc = missing.has(finding.docsPath)
        ? codeSpan(finding.docsPath)
        : fileLink(report, finding.docsPath);
      const section = finding.section
        ? ` › ${headingText(finding.section)}`
        : '';
      const label = finding.issue ? `**${finding.issue}** ` : '';
      lines.push(
        `- ${label}${doc}${section} — ${shorten(finding.update)}`,
        `  - Evidence: ${fileLink(report, finding.evidence.path)} — ${shorten(finding.evidence.detail)}`,
      );
    }
  }
  const hidden = count - COMMENT_MAX_FINDINGS;
  if (hidden > 0) {
    lines.push(
      `- …and ${hidden} more finding${hidden === 1 ? '' : 's'} in the workflow run report.`,
    );
  }
  if (report.gaps.length > 0) {
    lines.push('', 'Not covered by this review:');
    for (const gap of report.gaps) {
      lines.push(`- ${codeSpan(gap.scope)}: ${neutralize(gap.reason)}`);
    }
  }
  return lines.join('\n');
}

/** Nearest-rank percentile; `null` for an empty sample. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export interface CorpusSummary {
  runs: number;
  outcomes: Record<string, number>;
  latencyMs: Record<string, { p50: number | null; p95: number | null }>;
  tokens: { maxInput: number | null; maxOutput: number | null };
}

const STAGE_PHASES = [
  'queue',
  'open',
  'setup',
  'firstModelEvent',
  'model',
  'execution',
  'observed',
] as const;

export function summarizeCorpus(reports: DocsImpactReport[]): CorpusSummary {
  const outcomes: Record<string, number> = {};
  const samples: Record<string, number[]> = {
    total: [],
    ingest: [],
    retrieval: [],
  };
  const inputTokens: number[] = [];
  const outputTokens: number[] = [];
  for (const report of reports) {
    const key = report.status === 'failed' ? 'failed' : String(report.outcome);
    outcomes[key] = (outcomes[key] ?? 0) + 1;
    samples.total.push(report.timings.totalMs);
    samples.ingest.push(report.timings.ingestMs);
    samples.retrieval.push(report.timings.retrievalMs);
    for (const [stage, timing] of Object.entries(report.timings.stages)) {
      for (const phase of STAGE_PHASES) {
        const value = timing[`${phase}Ms`];
        if (value === null || value === undefined) continue;
        (samples[`${stage}.${phase}`] ??= []).push(value);
      }
      if (timing.inputTokens !== null) inputTokens.push(timing.inputTokens);
      if (timing.outputTokens !== null) outputTokens.push(timing.outputTokens);
    }
  }
  return {
    runs: reports.length,
    outcomes,
    latencyMs: Object.fromEntries(
      Object.entries(samples).map(([name, values]) => [
        name,
        { p50: percentile(values, 50), p95: percentile(values, 95) },
      ]),
    ),
    tokens: {
      maxInput: inputTokens.length ? Math.max(...inputTokens) : null,
      maxOutput: outputTokens.length ? Math.max(...outputTokens) : null,
    },
  };
}
