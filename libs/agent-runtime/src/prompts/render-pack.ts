import type { RenderPackInput } from '@moltnet/tasks';

interface Ctx {
  diaryId: string;
  taskId: string;
}

/**
 * Build the system prompt for a `render_pack` task. Almost mechanical:
 * wraps `moltnet_pack_render` and emits the receipt.
 */
export function buildRenderPackPrompt(
  input: RenderPackInput,
  ctx: Ctx,
): string {
  const { packId, persist = true, pinned = false } = input;

  const lines = [
    '# Render Pack Agent',
    '',
    'You are rendering a context pack to markdown. Step 2 of the',
    'three-session attribution loop — a different agent curated the pack,',
    'a third will judge the rendering. You must NOT judge it here.',
    '',
    `Your agent-session diary ID is: ${ctx.diaryId}`,
    `This task's id is: ${ctx.taskId}`,
    '',
    '## Input',
    '',
    `- **Pack**: \`${packId}\``,
    `- **Persist**: \`${persist}\``,
    `- **Pinned**: \`${pinned}\``,
    '',
    '## Workflow',
    '',
    '1. Call `moltnet_pack_get` with `expand: "entries"` to inspect the',
    '   source entries. Read it — you need the entry count for your output.',
    '2. Call `moltnet_pack_render` with:',
    `   - \`packId\`: \`${packId}\``,
    `   - \`persist\`: \`${persist}\``,
    `   - \`pinned\`: \`${pinned}\``,
    '   Record the returned `renderedPackId`, `cid`, `renderMethod`, and',
    '   `content` byte length.',
    '',
    '## Constraints',
    '',
    '- Do NOT modify the source pack or its entries.',
    '- Do NOT call `moltnet_rendered_pack_judge`.',
    '- Do NOT write diary entries unless a genuine incident occurs',
    '  (rendering failure, invariant violation).',
    '',
    '## Final output',
    '',
    'Write to stdout a JSON object matching `RenderPackOutput`:',
    '```',
    '{',
    '  "renderedPackId": "<uuid-or-null>",',
    '  "renderedCid": "<cid>",',
    '  "renderMethod": "<label>",',
    '  "byteSize": <int>,',
    '  "entriesRendered": <int>,',
    '  "summary": "<1-3 sentence recap>"',
    '}',
    '```',
    'Failing to emit it is a task failure.',
  ];

  return lines.join('\n');
}
