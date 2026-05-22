import type { RenderPackInput } from '@moltnet/tasks';

import {
  type AssembledPrompt,
  assembleTaskPrompt,
  type PromptSection,
} from './assemble.js';
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
): AssembledPrompt {
  const { packId, persist = true, pinned = false } = input;

  const header = [
    '# Render Pack Agent',
    '',
    'You are rendering a context pack to markdown. Step 2 of the',
    'three-session attribution loop — a different agent curated the pack,',
    'a third will judge the rendering. You must NOT judge it here.',
    '',
    `Your agent-session diary ID is: ${ctx.diaryId}`,
    `This task's id is: ${ctx.taskId}`,
  ].join('\n');

  const inputBlock = [
    `- **Pack**: \`${packId}\``,
    `- **Persist**: \`${persist}\``,
    `- **Pinned**: \`${pinned}\``,
  ].join('\n');

  const workflow = [
    '1. Call `moltnet_pack_get` with `expandEntries: true` to inspect the',
    '   source entries. Read it — you need the entry count for your output.',
    '2. Call `moltnet_pack_render` with:',
    `   - \`packId\`: \`${packId}\``,
    `   - \`persist\`: \`${persist}\``,
    `   - \`pinned\`: \`${pinned}\``,
    '   Record the returned `renderedPackId`, `cid`, `renderMethod`, and',
    '   `content` byte length.',
  ].join('\n');

  const constraints = [
    '- Do NOT modify the source pack or its entries.',
    '- Do NOT write diary entries unless a genuine incident occurs',
    '  (rendering failure, invariant violation).',
  ].join('\n');

  const fidelity = [
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
  ].join('\n');

  const sections: PromptSection[] = [
    { id: 'render_pack.header', source: 'header', body: header },
    {
      id: 'render_pack.input',
      source: 'task_input',
      header: 'Input',
      body: inputBlock,
    },
    {
      id: 'render_pack.workflow',
      source: 'static',
      header: 'Workflow',
      body: workflow,
    },
    {
      id: 'render_pack.constraints',
      source: 'static',
      header: 'Constraints',
      body: constraints,
    },
    {
      id: 'render_pack.fidelity',
      source: 'static',
      header: 'Fidelity Discipline',
      body: fidelity,
    },
    {
      id: 'render_pack.verification',
      source: 'verification',
      body: buildSelfVerificationBlock(ctx.taskId),
    },
    {
      id: 'render_pack.final_output',
      source: 'final_output',
      body: buildFinalOutputBlock({
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
    },
  ];

  return assembleTaskPrompt('render_pack', sections);
}
