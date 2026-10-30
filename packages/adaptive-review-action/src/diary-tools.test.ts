import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { PiToolContext } from '@themoltnet/pi-runtime';
import { describe, expect, it, vi } from 'vitest';

import { createReviewDiaryTools } from './diary-tools.js';

const source = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const entryId = '33333333-3333-4333-8333-333333333333';
function context() {
  const search = vi.fn().mockResolvedValue({ results: [] });
  const list = vi.fn().mockResolvedValue({ items: [] });
  return {
    search,
    list,
    value: { agent: { entries: { search, list } } } as unknown as PiToolContext,
  };
}
async function materialize(ids = [source], ctx = context()) {
  const contributions = createReviewDiaryTools(ids);
  const [search, get] = await Promise.all(
    contributions.map((tool) => tool.create(ctx.value)),
  );
  return { ...ctx, searchTool: search!, getTool: get!, contributions };
}

describe('review-owned diary tools', () => {
  it('rejects empty, malformed and oversized trusted source configuration', () => {
    for (const ids of [[], ['nope'], Array<string>(9).fill(source)]) {
      expect(() => createReviewDiaryTools(ids)).toThrow('1–8 diary UUIDs');
    }
  });

  it('captures allowed sources in descriptors and does not follow later input mutation', async () => {
    const ids = [source];
    const tools = await materialize(ids);
    ids[0] = other;
    expect(
      JSON.stringify(tools.contributions[0]!.descriptor.parameters),
    ).toContain(source);
    await expect(
      execute(tools.searchTool, { query: 'incident', diaryId: other }),
    ).rejects.toThrow('configured review sources');
    expect(tools.search).not.toHaveBeenCalled();
  });

  it('requires explicit selection with multiple sources and rejects outside sources before SDK calls', async () => {
    const tools = await materialize([source, other]);
    await expect(
      execute(tools.searchTool, { query: 'incident' }),
    ).rejects.toThrow('Choose a diary');
    await expect(
      execute(tools.getTool, { entryId, diaryId: entryId }),
    ).rejects.toThrow('Choose a diary');
    expect(tools.search).not.toHaveBeenCalled();
    expect(tools.list).not.toHaveBeenCalled();
    await execute(tools.searchTool, {
      query: 'incident',
      diaryId: other,
    });
    expect(tools.search).toHaveBeenCalledWith({
      diaryId: other,
      query: 'incident',
      tags: undefined,
      limit: 5,
    });
  });

  it('bounds search hits and previews, preserving source and API-reported hash', async () => {
    const tools = await materialize();
    tools.search.mockResolvedValue({
      results: Array.from({ length: 7 }, () => ({
        id: entryId,
        content: 'x'.repeat(500),
        contentHash: 'api-hash',
      })),
    });
    const result = await execute(tools.searchTool, {
      query: 'incident',
    });
    const entries = JSON.parse((result.content[0] as { text: string }).text);
    expect(entries).toHaveLength(5);
    expect(entries[0]).toMatchObject({
      diaryId: source,
      contentHash: 'api-hash',
      contentPreview: 'x'.repeat(200),
    });
  });

  it('fetches through the diary-scoped endpoint and bounds content', async () => {
    const tools = await materialize();
    tools.list.mockResolvedValue({
      items: [
        { id: entryId, content: 'x'.repeat(13000), contentHash: 'api-hash' },
      ],
    });
    const result = await execute(tools.getTool, { entryId });
    expect(tools.list).toHaveBeenCalledWith(source, { ids: [entryId] });
    expect(
      JSON.parse((result.content[0] as { text: string }).text),
    ).toMatchObject({
      diaryId: source,
      content: 'x'.repeat(12000),
      truncated: true,
      contentHash: 'api-hash',
    });
  });

  it('does not return an unrelated entry from a source response', async () => {
    const tools = await materialize();
    tools.list.mockResolvedValue({
      items: [{ id: other, content: 'not the requested entry' }],
    });
    await expect(execute(tools.getTool, { entryId })).rejects.toThrow(
      'unavailable',
    );
  });

  it('shares eight live calls across both tools, counts denials, and isolates contexts', async () => {
    const tools = await materialize();
    tools.search.mockRejectedValue(new Error('denied'));
    await expect(
      execute(tools.searchTool, { query: 'incident' }),
    ).rejects.toThrow('denied');
    for (let i = 0; i < 7; i++) {
      await expect(execute(tools.getTool, { entryId })).rejects.toThrow(
        'unavailable',
      );
    }
    await expect(
      execute(tools.searchTool, { query: 'incident' }),
    ).rejects.toThrow('budget exhausted');
    expect(tools.search).toHaveBeenCalledTimes(1);
    expect(tools.list).toHaveBeenCalledTimes(7);
    const another = context();
    const freshTool = await tools.contributions[0]!.create(another.value);
    await execute(freshTool, { query: 'incident' });
    expect(another.search).toHaveBeenCalledTimes(1);
  });
});

function execute(tool: ToolDefinition, params: Record<string, unknown>) {
  return tool.execute(
    'call',
    params,
    new AbortController().signal,
    () => {},
    {} as never,
  );
}
