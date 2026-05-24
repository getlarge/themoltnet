import { describe, expect, it } from 'vitest';

import type { ToolCaller } from './tool-caller.js';
import { callTool } from './tool-calls.js';

function caller(): {
  app: ToolCaller;
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
} {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const app: ToolCaller = {
    callServerTool: (input) => {
      calls.push(input);
      return Promise.resolve({});
    },
  };
  return { app, calls };
}

describe('callTool', () => {
  it('forwards the tool name and arguments', async () => {
    const { app, calls } = caller();
    await callTool(app, 'diary_tags', { diary_id: 'd1' });
    expect(calls[0]).toEqual({
      name: 'diary_tags',
      arguments: { diary_id: 'd1' },
    });
  });

  it('strips undefined argument keys before sending', async () => {
    const { app, calls } = caller();
    await callTool(app, 'entries_list', {
      diary_id: 'd1',
      limit: 20,
      offset: undefined,
      tags: ['scope:auth'],
    });
    expect(calls[0].arguments).toEqual({
      diary_id: 'd1',
      limit: 20,
      tags: ['scope:auth'],
    });
    expect(calls[0].arguments).not.toHaveProperty('offset');
  });

  // The compile-time guarantee (wrong tool name or arg shape is rejected) is
  // enforced by tsc, not assertable at runtime; these `@ts-expect-error` lines
  // fail the typecheck if the mapping ever stops catching mismatches.
  it('rejects unknown tool names + wrong arg shapes at compile time', async () => {
    const { app } = caller();
    // @ts-expect-error unknown tool name
    await callTool(app, 'not_a_tool', { diary_id: 'd1' });
    // @ts-expect-error packs_update requires pack_id, not diary_id
    await callTool(app, 'packs_update', { diary_id: 'd1' });
    expect(true).toBe(true);
  });
});
