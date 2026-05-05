/**
 * Build the closing "final output" block that every task-type prompt ends
 * with. Two affordances are described in the same order, with explicit
 * preference for the submit-tool path:
 *
 *   1. Call `submit_<task_type>_output` exactly once with the structured
 *      payload. This is the preferred path. The runtime captures the
 *      validated args and ends the session via pi-coding-agent's
 *      `terminate: true`.
 *   2. As a fallback, emit the same JSON object as the agent's very last
 *      assistant message. The runtime parses it with
 *      `parseStructuredTaskOutput`. This path is being deprecated; use it
 *      only if the submit-tool is unavailable for any reason.
 *
 * The wording is intentionally absolute ("MUST", "even if the work
 * succeeded") because the failure mode the issue tracks (#986) is models
 * treating "your final message must be JSON" as advice rather than a hard
 * requirement.
 */
export interface FinalOutputBlockOptions {
  /** Task-type slug, e.g. `fulfill_brief`. */
  taskType: string;
  /** Capitalised TypeBox schema name, e.g. `FulfillBriefOutput`. */
  outputSchemaName: string;
  /**
   * Compact JSON sketch of the output shape. Indented with 2 spaces, no
   * outer fence; the helper wraps it in a markdown fence.
   */
  shapeSketch: string;
  /**
   * Optional task-specific notes appended after the block (e.g. composite
   * recompute warning for judge tasks). Each line written verbatim.
   */
  extraNotes?: string[];
}

export function buildFinalOutputBlock(opts: FinalOutputBlockOptions): string {
  const { taskType, outputSchemaName, shapeSketch, extraNotes } = opts;
  const submitTool = `submit_${taskType}_output`;

  const lines: string[] = [
    '## Final output (read this carefully)',
    '',
    `Your VERY LAST action in this conversation MUST report the structured`,
    `output matching \`${outputSchemaName}\`. Two ways to do it, in order of`,
    `preference:`,
    '',
    `1. **Preferred — call \`${submitTool}\` exactly once** with the payload.`,
    `   The runtime captures the validated arguments and ends the session.`,
    `   If the tool is registered, prefer this path.`,
    `2. **Fallback** — if the submit tool is unavailable, your very last`,
    `   assistant message MUST be a single JSON object matching`,
    `   \`${outputSchemaName}\`. No prose before or after. No code fences.`,
    `   No "ok" or "done". The runtime parses the last balanced top-level`,
    `   JSON object as the output.`,
    '',
    `Failing to report structured output as the very last action means the`,
    `attempt is marked failed even if the underlying work succeeded.`,
    '',
    `Output shape:`,
    '',
    '```json',
    shapeSketch,
    '```',
  ];

  if (extraNotes?.length) {
    lines.push('');
    for (const note of extraNotes) lines.push(note);
  }

  return lines.join('\n');
}
