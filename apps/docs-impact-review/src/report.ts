import type { DocsImpactReport } from './types.js';

export const DOCS_IMPACT_COMMENT_MARKER = '<!-- moltnet:docs-impact-review -->';

/** Comment-side cap for free text; validation only guards runaway output. */
export const COMMENT_TEXT_MAX = 280;

export function shorten(text: string, max = COMMENT_TEXT_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * One concise PR comment body. Clean results stay on one line; a failed run
 * says so explicitly instead of looking like an empty clean result.
 */
export function renderComment(report: DocsImpactReport): string {
  const head = `head \`${report.headRevision}\``;
  if (report.status === 'failed' || !report.outcome) {
    return [
      DOCS_IMPACT_COMMENT_MARKER,
      `**Docs impact: not reviewed** · ${head}`,
      '',
      `The review did not complete: ${report.error ?? 'unknown error'}. No judgment was made.`,
    ].join('\n');
  }
  const lines = [
    DOCS_IMPACT_COMMENT_MARKER,
    `**Docs impact: ${report.outcome}** · ${head}`,
  ];
  if (report.findings.length > 0) {
    lines.push('');
    for (const finding of report.findings) {
      const section = finding.section ? ` › ${finding.section}` : '';
      lines.push(
        `- \`${finding.docsPath}\`${section} — ${shorten(finding.update)} (evidence: \`${finding.evidence.path}\`: ${shorten(finding.evidence.detail)})`,
      );
    }
  }
  if (report.gaps.length > 0) {
    lines.push('', 'Not covered by this review:');
    for (const gap of report.gaps) {
      lines.push(`- \`${gap.scope}\`: ${gap.reason}`);
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
