import type { MultiLensReviewPublishedOutput } from './types.js';

export const MULTI_LENS_REVIEW_COMMENT_MARKER =
  '<!-- moltnet:multi-lens-review -->';

function diagnosticsMarkdown(
  diagnostics: MultiLensReviewPublishedOutput['diagnostics'],
): string {
  const topicRows = diagnostics.topics
    .map(
      (topic) =>
        `| \`${topic.id}\` | ${topic.primaryFiles} | ${topic.contextFiles} | ` +
        `${topic.bytes} | ${topic.lanes.join(', ')} |`,
    )
    .join('\n');
  const exclusions = diagnostics.coverage.excludedFiles
    .map(
      (file) =>
        `- \`${file.path}\` — ${file.reason} (${file.source})` +
        (file.evidence ? ` — ${file.evidence}` : ''),
    )
    .join('\n');
  const cost = diagnostics.cost;
  return (
    `\n\n### Topic and coverage diagnostics\n\n` +
    `| Topic | Primary | Context | Bytes | Lanes |\n` +
    `| --- | ---: | ---: | ---: | --- |\n` +
    `${topicRows || '| — | 0 | 0 | 0 | — |'}\n\n` +
    `Primary coverage: **${diagnostics.coverage.complete ? 'complete' : 'incomplete'}**\n\n` +
    `<details><summary>Trusted exclusions</summary>\n\n` +
    `${exclusions || '- None'}\n\n</details>\n\n` +
    `Tasks: **${cost.tasks}** · Artifacts: **${cost.artifacts}** ` +
    `(${cost.artifactBytes} bytes) · Tokens: **${cost.inputTokens} in / ` +
    `${cost.outputTokens} out**`
  );
}

export function renderMultiLensReviewComment(
  result: MultiLensReviewPublishedOutput,
  runDetails: string,
): string {
  const header = `${MULTI_LENS_REVIEW_COMMENT_MARKER}\n## MoltNet multi-lens review\n\n`;
  const diagnostics = diagnosticsMarkdown(result.diagnostics);
  if (result.outcome === 'completed' && result.verdict) {
    const findings = result.verdict.findings
      .map((finding) => {
        const location = finding.location ? `:${finding.location}` : '';
        return (
          `- **${finding.severity}** \`${finding.path}${location}\` — ` +
          `${finding.description}\n  - Impact: ${finding.impact}\n` +
          `  - Fix: ${finding.fix}`
        );
      })
      .join('\n');
    return (
      header +
      `Recommendation: **${result.verdict.recommendation}**\n\n` +
      `${result.verdict.summary}\n\n### Findings\n\n` +
      `${findings || '- None'}` +
      diagnostics +
      `\n\n_${runDetails}_`
    );
  }
  if (result.outcome === 'pivot' && result.preflight) {
    return (
      header +
      `Outcome: **pivot before line-level review**\n\n` +
      result.preflight.summary +
      diagnostics +
      `\n\n_${runDetails}_`
    );
  }
  if (result.outcome === 'questions' && result.preflight) {
    const questions = (result.preflight.questions ?? [])
      .map((question) => `- ${question}`)
      .join('\n');
    return (
      header +
      `Outcome: **questions**\n\n${result.preflight.summary}\n\n` +
      `### Questions\n\n${questions || '- No questions were returned.'}` +
      diagnostics +
      `\n\n_${runDetails}_`
    );
  }
  return (
    header +
    `The review completed, but its outcome payload was not recognized. ` +
    `${runDetails}.`
  );
}
