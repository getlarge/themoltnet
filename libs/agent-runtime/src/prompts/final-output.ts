/**
 * Build the closing "final output" block that every task-type prompt ends
 * with. The submit-tool path is the only supported completion path for
 * built-in task types:
 *
 *   1. Call `submit_<task_type>_output` exactly once with the structured
 *      payload. This is the preferred path. The runtime captures the
 *      validated args and the executor reads that captured state after
 *      the session ends.
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
    `The runtime captures the validated arguments for attempt completion.`,
    `Do NOT emit the output as plain assistant text. Do NOT rely on a`,
    `JSON-in-message fallback. If you do not call \`${submitTool}\`, the`,
    `attempt is recorded as failing the promised submit-output criterion`,
    `even if the underlying work succeeded.`,
    '',
    `Your final assistant text before that tool call may explain your work,`,
    `but the submit-tool call itself must be your VERY LAST action.`,
    '',
    `Task artifacts: when you produce large files, binary files, logs, reports,`,
    `screenshots, traces, bundles, or datasets, save them in the task workspace`,
    `and call \`moltnet_upload_task_artifact\` before the submit-output tool.`,
    `Put the returned artifact CID in the structured output where the schema`,
    `allows artifact metadata (for example \`artifacts[].cid\`). Do not paste`,
    `large bytes into structured output.`,
    '',
    `Referenced inputs: if this task depends on prior task artifacts, call`,
    `\`moltnet_list_task_artifacts\` for the referenced task and download the`,
    `specific CID you need with \`moltnet_download_task_artifact\` before judging`,
    `or continuing that work.`,
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
