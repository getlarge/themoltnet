import { describe, expect, it } from 'vitest';

import {
  readSubmitStructure,
  type SubmitStructureAgent,
  type SubmitStructureMessage,
} from '../src/submit-structure.js';

function pagedAgent(
  messages: SubmitStructureMessage[],
  pageSize: number,
): { agent: SubmitStructureAgent; queries: unknown[] } {
  const queries: unknown[] = [];
  return {
    queries,
    agent: {
      tasks: {
        listMessages: async (_taskId, _attemptN, query) => {
          queries.push(query);
          return messages
            .filter((message) => message.seq > (query?.afterSeq ?? 0))
            .slice(0, pageSize);
        },
      },
    },
  };
}

describe('readSubmitStructure', () => {
  it('pages past the first page to find the output completion', async () => {
    // Arrange
    const messages: SubmitStructureMessage[] = [
      ...Array.from({ length: 60 }, (_, index) => ({
        seq: index + 1,
        kind: 'tool_call_end',
        payload: {
          tool_name: 'submit_freeform_output',
          is_error: index < 2,
        },
      })),
      {
        seq: 61,
        kind: 'info',
        payload: {
          event: 'output_completion',
          output_source: 'submit_tool',
          repair_kinds: ['optional_null', 7],
        },
      },
    ];
    const { agent, queries } = pagedAgent(messages, 50);

    // Act
    const structure = await readSubmitStructure(agent, 'task', 1, 'freeform');

    // Assert
    expect(structure).toEqual({
      invalidSubmitCalls: 2,
      repairKinds: ['optional_null'],
      outputSource: 'tool',
    });
    expect(queries).toEqual([
      { kind: ['info', 'tool_call_end'] },
      { kind: ['info', 'tool_call_end'], afterSeq: 50 },
      { kind: ['info', 'tool_call_end'], afterSeq: 61 },
    ]);
  });

  it('reports no output source when the attempt never completed', async () => {
    const { agent } = pagedAgent([], 50);

    const structure = await readSubmitStructure(agent, 'task', 1, 'freeform');

    expect(structure).toEqual({
      invalidSubmitCalls: 0,
      repairKinds: [],
      outputSource: null,
    });
  });
});
