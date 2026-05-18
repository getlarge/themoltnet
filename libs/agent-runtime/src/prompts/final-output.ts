/**
 * Build the closing "final output" block that every task-type prompt ends
 * with. The submit-tool path is the only supported completion path for
 * built-in task types:
 *
 *   1. Call `submit_<task_type>_output` exactly once with the structured
 *      payload. This is the preferred path. The runtime captures the
 *      validated args and ends the session via pi-coding-agent's
 *      `terminate: true`.
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

import { submitOutputToolName } from '../output-tools.js';

export function buildFinalOutputBlock(opts: FinalOutputBlockOptions): string {
  const { taskType, outputSchemaName, shapeSketch, extraNotes } = opts;
  // Pulled from the submit-output contract so the prompt and the
  // executor that registers the tool share one source of truth.
  const submitTool = submitOutputToolName(taskType);

  const lines: string[] = [
    '## Final output (read this carefully)',
    '',
    `Your VERY LAST action in this conversation MUST report the structured`,
    `output matching \`${outputSchemaName}\`.`,
    '',
    `Call \`${submitTool}\` exactly once with the payload.`,
    `The runtime captures the validated arguments and ends the session.`,
    `Do NOT emit the output as plain assistant text. Do NOT rely on a`,
    `JSON-in-message fallback. If you do not call \`${submitTool}\`, the`,
    `attempt fails even if the underlying work succeeded.`,
    '',
    `Your final assistant text before that tool call may explain your work,`,
    `but the submit-tool call itself must be your VERY LAST action.`,
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
