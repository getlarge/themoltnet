import { SUBMIT_REPAIR_KINDS, type SubmitRepairKind } from '@moltnet/tasks';

import type { SubmitStructure } from './score-matrix.js';

const KNOWN_REPAIR_KINDS: ReadonlySet<string> = new Set(SUBMIT_REPAIR_KINDS);

function isSubmitRepairKind(kind: string): kind is SubmitRepairKind {
  return KNOWN_REPAIR_KINDS.has(kind);
}

/** Minimal shape of a paged task message (a structural subset of the SDK's
 * `TaskMessage`). */
export interface SubmitStructureMessage {
  seq: number;
  kind: string;
  payload: { [key: string]: unknown };
}

/** The narrow slice of the SDK `Agent` that `readSubmitStructure` needs. */
export interface SubmitStructureAgent {
  tasks: {
    listMessages(
      taskId: string,
      attemptN: number,
      query?: { afterSeq?: number; kind?: Array<'info' | 'tool_call_end'> },
    ): Promise<SubmitStructureMessage[]>;
  };
}

// Text deltas are stored one row per chunk, so a single page rarely reaches
// the terminal `output_completion` event. Filter server-side and page by seq.
const STRUCTURE_KINDS: Array<'info' | 'tool_call_end'> = [
  'info',
  'tool_call_end',
];

async function listAllStructureMessages(
  agent: SubmitStructureAgent,
  taskId: string,
  attemptN: number,
): Promise<SubmitStructureMessage[]> {
  const messages: SubmitStructureMessage[] = [];
  let afterSeq: number | undefined;
  for (;;) {
    const page = await agent.tasks.listMessages(taskId, attemptN, {
      kind: STRUCTURE_KINDS,
      ...(afterSeq === undefined ? {} : { afterSeq }),
    });
    if (page.length === 0) return messages;
    messages.push(...page);
    afterSeq = page[page.length - 1].seq;
  }
}

/** Read how the model used the submit tool in one attempt: invalid calls, the
 * repairs applied to the accepted call, and where the output came from. */
export async function readSubmitStructure(
  agent: SubmitStructureAgent,
  taskId: string,
  attemptN: number,
  taskType: string,
): Promise<SubmitStructure> {
  const messages = await listAllStructureMessages(agent, taskId, attemptN);
  const submitName = `submit_${taskType}_output`;
  const invalidSubmitCalls = messages.filter(
    (message) =>
      message.kind === 'tool_call_end' &&
      message.payload.tool_name === submitName &&
      message.payload.is_error === true,
  ).length;
  const completion = messages.find(
    (message) =>
      message.kind === 'info' && message.payload.event === 'output_completion',
  )?.payload;
  const reported = Array.isArray(completion?.repair_kinds)
    ? completion.repair_kinds.filter(
        (kind): kind is string => typeof kind === 'string',
      )
    : [];
  const repairKinds = reported.filter(isSubmitRepairKind);
  const unknownRepairKinds = reported.filter(
    (kind) => !isSubmitRepairKind(kind),
  );
  const outputSource =
    completion?.output_source === 'submit_tool'
      ? ('tool' as const)
      : completion?.output_source === 'final_message'
        ? ('final_message' as const)
        : null;
  return {
    invalidSubmitCalls,
    repairKinds,
    ...(unknownRepairKinds.length > 0 ? { unknownRepairKinds } : {}),
    outputSource,
  };
}
