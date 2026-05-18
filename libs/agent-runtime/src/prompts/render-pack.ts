import type { RenderPackInput } from '@moltnet/tasks';

import { buildFinalOutputBlock } from './final-output.js';
import { buildSelfVerificationBlock } from './self-verification.js';

interface Ctx {
  diaryId: string;
  taskId: string;
}

/**
 * Build the first user-message prompt for a `render_pack` task. Almost mechanical:
 * wraps `moltnet_pack_render` and emits the receipt.
 */
export function buildRenderPackUserPrompt(
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
    '1. Call `moltnet_pack_get` with `expandEntries: true` to inspect the',
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
    '- Do NOT write diary entries unless a genuine incident occurs',
    '  (rendering failure, invariant violation).',
    '',
    '## Fidelity Discipline',
    '',
    'These rules apply when you are producing the markdown yourself rather',
    'than relying on a deterministic `server:*` renderer.',
    '',
    '1. Preserve hedges and qualifiers verbatim.',
    '   Source phrases like "typically", "roughly", "about half",',
    '   "in this codebase", "for this speaker", and "on most slides"',
    '   are load-bearing. Keep them. Do not turn a partial observation',
    '   into a universal claim by stripping the hedge.',
    '2. Signal list truncation explicitly.',
    '   If a source entry enumerates examples and you shorten the list,',
    '   say so with markers like `e.g.`, `among others`, or',
    '   `[truncated - see source for full list]`. Do not silently drop',
    '   items from an enumeration in a way that looks lossless.',
    '3. Calibrate against fidelity scoring.',
    '   A paraphrased rendered pack will be audited claim-by-claim for',
    '   drift on quotes, numbers, file paths, hedges, polarity, and list',
    '   completeness. Optimize for "no detectable drift across a',
    '   claim-by-claim audit", not "shorter at any cost". When compressing, prefer',
    '   tightening prose around a quote rather than altering the quote,',
    '   and prefer summarising a list over silently truncating it.',
    '',
    buildSelfVerificationBlock(ctx.taskId),
    buildFinalOutputBlock({
      taskType: 'render_pack',
      outputSchemaName: 'RenderPackOutput',
      shapeSketch: [
        '{',
        '  "renderedPackId": "<uuid-or-null>",',
        '  "renderedCid": "<cid>",',
        '  "renderMethod": "<label>",',
        '  "byteSize": <int>,',
        '  "entriesRendered": <int>,',
        '  "summary": "<1-3 sentence recap>",',
        '  "verification": <required iff input.successCriteria; see Self-verification>',
        '}',
      ].join('\n'),
    }),
  ];

  return lines.join('\n');
}
