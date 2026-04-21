import { describe, expect, it, vi } from 'vitest';

import { createMoltNetTools, type MoltNetToolsConfig } from './tools.js';

const DIARY_ID = '11111111-1111-1111-1111-111111111111';

type AnyTool = ReturnType<typeof createMoltNetTools>[number];

function findTool(tools: AnyTool[], name: string): AnyTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

// pi's defineTool expects execute(id, params, signal, onUpdate, ctx) — pass
// stubs for the last three so the type-checker is happy without the tests
// caring about their shape.
function invoke(tool: AnyTool, params: Record<string, unknown>) {
  return tool.execute(
    'call-id',
    params as any,
    new AbortController().signal,
    () => undefined,
    {} as any,
  );
}

// Build a config whose getAgent() returns a minimally-shaped agent stub.
// The stub only needs the methods each test hits; we cast through unknown
// because the full MoltNet agent type is deep and every branch would drag in
// the entire SDK surface for no extra signal.
function makeConfig(agentStub: Record<string, unknown>): MoltNetToolsConfig {
  return {
    getAgent: () =>
      agentStub as unknown as ReturnType<MoltNetToolsConfig['getAgent']>,
    getDiaryId: () => DIARY_ID,
    getSessionErrors: () => [],
    clearSessionErrors: () => undefined,
  };
}

describe('moltnet_diary_tags', () => {
  it('passes optional filters through as the SDK query shape', async () => {
    const tags = vi.fn().mockResolvedValue({
      tags: [{ tag: 'scope:auth', count: 12 }],
      total: 1,
    });

    const tools = createMoltNetTools(makeConfig({ diaries: { tags } }));
    const tool = findTool(tools, 'moltnet_diary_tags');

    const result = await invoke(tool, {
      prefix: 'scope:',
      minCount: 3,
      entryTypes: ['semantic', 'procedural'],
    });

    expect(tags).toHaveBeenCalledWith(DIARY_ID, {
      prefix: 'scope:',
      minCount: 3,
      entryTypes: ['semantic', 'procedural'],
    });
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      tags: [{ tag: 'scope:auth', count: 12 }],
      total: 1,
    });
  });

  it('omits unspecified filters so the server applies its defaults', async () => {
    const tags = vi.fn().mockResolvedValue({ tags: [], total: 0 });

    const tools = createMoltNetTools(makeConfig({ diaries: { tags } }));
    const tool = findTool(tools, 'moltnet_diary_tags');

    await invoke(tool, {});

    expect(tags).toHaveBeenCalledWith(DIARY_ID, {});
  });

  it('fails when no agent is connected', async () => {
    const tools = createMoltNetTools({
      getAgent: () => null,
      getDiaryId: () => DIARY_ID,
      getSessionErrors: () => [],
      clearSessionErrors: () => undefined,
    });
    const tool = findTool(tools, 'moltnet_diary_tags');

    await expect(invoke(tool, {})).rejects.toThrow(/MoltNet not connected/);
  });
});

describe('moltnet_pack_create', () => {
  it('persists a ranked custom pack with recipe metadata', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'pack-1',
      packCid: 'bafycidpack',
      diaryId: DIARY_ID,
      pinned: true,
    });

    const tools = createMoltNetTools(makeConfig({ packs: { create } }));
    const tool = findTool(tools, 'moltnet_pack_create');

    const result = await invoke(tool, {
      entries: [
        { entryId: 'entry-a', rank: 1 },
        { entryId: 'entry-b', rank: 2 },
      ],
      params: { recipe: 'legreffier-explore-v1', prompt: 'review auth flow' },
      tokenBudget: 8000,
      pinned: true,
    });

    expect(create).toHaveBeenCalledWith(DIARY_ID, {
      packType: 'custom',
      params: { recipe: 'legreffier-explore-v1', prompt: 'review auth flow' },
      entries: [
        { entryId: 'entry-a', rank: 1 },
        { entryId: 'entry-b', rank: 2 },
      ],
      tokenBudget: 8000,
      pinned: true,
    });
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text).id).toBe('pack-1');
  });

  it('defaults params to an empty object so the server receives a valid body', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'pack-2' });

    const tools = createMoltNetTools(makeConfig({ packs: { create } }));
    const tool = findTool(tools, 'moltnet_pack_create');

    await invoke(tool, {
      entries: [{ entryId: 'entry-a', rank: 1 }],
    });

    expect(create).toHaveBeenCalledWith(DIARY_ID, {
      packType: 'custom',
      params: {},
      entries: [{ entryId: 'entry-a', rank: 1 }],
      tokenBudget: undefined,
      pinned: undefined,
    });
  });
});
