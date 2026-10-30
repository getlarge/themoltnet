import { readFileSync } from 'node:fs';

import { assertGuestEnvironmentBoundary } from '@themoltnet/sandbox-gondolin';
import { describe, expect, it, vi } from 'vitest';

import { parseDiaryReadIds } from './diary-read-scope.js';
import { createMoltNetTools, type MoltNetToolsConfig } from './tools.js';

const source = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const entry = {
  id: 'entry',
  content: 'Historical decision',
  contentHash: 'cid',
  title: 'Prior incident',
  tags: [],
  importance: 5,
  createdAt: '2026-01-01',
};

function fixture(ids?: readonly string[]) {
  const agent = {
    entries: {
      search: vi.fn().mockResolvedValue({ results: [entry] }),
      list: vi.fn().mockResolvedValue({ items: [entry] }),
      get: vi.fn().mockResolvedValue(entry),
    },
  };
  const tools = createMoltNetTools({
    getAgent: () =>
      agent as unknown as ReturnType<MoltNetToolsConfig['getAgent']>,
    getDiaryId: () => 'output-diary',
    getTeamId: () => 'team',
    getSessionErrors: () => [],
    clearSessionErrors: () => {},
    readDiaryIds: ids,
  });
  return {
    agent,
    call: (name: string, args: Record<string, unknown>) => {
      const tool = tools.find((item) => item.name === name)!;
      return tool.execute(
        'call',
        args,
        new AbortController().signal,
        () => {},
        null as unknown as Parameters<typeof tool.execute>[4],
      );
    },
  };
}

describe('review diary sources', () => {
  it('ships a disabled scoped profile compatible with the guest boundary, without changing default access', () => {
    const read = (path: string) =>
      JSON.parse(
        readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8'),
      );
    const profile = read(
      '.github/runtime-profiles/legreffier-adaptive-knowledge-review-v1.json',
    );
    const policy = read(
      '.github/runtime-policies/legreffier-adaptive-knowledge-readonly-v1.json',
    );
    const standard = read(
      '.github/runtime-policies/legreffier-adaptive-focused-readonly-v1.json',
    );
    expect(() =>
      assertGuestEnvironmentBoundary({
        sandboxEnv: profile.sandbox.env,
        forwardEnv: profile.requiredEnv,
      }),
    ).not.toThrow();
    expect(parseDiaryReadIds(profile.sandbox.env.REVIEW_DIARY_IDS)).toEqual([]);
    expect(profile.toolEnforcement).toBe('enforce');
    expect(policy.shellCommands).toEqual([]);
    expect(policy.tools).toEqual([
      'find',
      'grep',
      'ls',
      'read',
      'moltnet_search_review_entries',
      'moltnet_get_review_entry',
    ]);
    expect(standard.tools).toEqual(['find', 'grep', 'ls', 'read']);
  });

  it('requires explicit valid source configuration; empty is denied, absent leaves ordinary tools unchanged', async () => {
    expect(parseDiaryReadIds(undefined)).toBeUndefined();
    expect(parseDiaryReadIds('[]')).toEqual([]);
    expect(parseDiaryReadIds(JSON.stringify([source, source]))).toEqual([
      source,
    ]);
    for (const value of [
      'null',
      '{}',
      '["not-a-uuid"]',
      JSON.stringify(Array(9).fill(source)),
    ]) {
      expect(() => parseDiaryReadIds(value)).toThrow();
    }
    for (const ids of [undefined, []]) {
      const { call, agent } = fixture(ids);
      await expect(
        call('moltnet_search_review_entries', { query: 'incident' }),
      ).rejects.toThrow();
      await expect(
        call('moltnet_get_review_entry', { entryId: 'entry' }),
      ).rejects.toThrow();
      expect(agent.entries.search).not.toHaveBeenCalled();
      expect(agent.entries.list).not.toHaveBeenCalled();
      expect(agent.entries.get).not.toHaveBeenCalled();
    }
    const { call, agent } = fixture();
    await call('moltnet_search_entries', { query: 'ordinary search' });
    expect(agent.entries.search).toHaveBeenCalledWith({
      diaryId: 'output-diary',
      query: 'ordinary search',
      limit: 5,
    });
    await call('moltnet_get_entry', { entryId: 'entry' });
    expect(agent.entries.get).toHaveBeenCalledWith('entry');
  });

  it('keeps source diaries separate from the task output diary and bounds search results', async () => {
    const { call, agent } = fixture([source, other]);
    agent.entries.search.mockResolvedValue({ results: Array(20).fill(entry) });
    const response = await call('moltnet_search_review_entries', {
      diaryId: other,
      query: 'cache incident',
      limit: 100,
      tags: ['incident'],
    });
    expect(agent.entries.search).toHaveBeenCalledWith({
      diaryId: other,
      query: 'cache incident',
      limit: 5,
      tags: ['incident'],
    });
    expect(
      JSON.parse((response.content[0] as { text: string }).text),
    ).toHaveLength(5);
    await expect(
      call('moltnet_search_review_entries', {
        diaryId: 'output-diary',
        query: 'anything',
      }),
    ).rejects.toThrow('configured read sources');
    await expect(
      call('moltnet_search_review_entries', { query: 'ambiguous diary' }),
    ).rejects.toThrow('configured read sources');
    expect(agent.entries.search).toHaveBeenCalledTimes(1);
  });

  it('fetches only through the diary-scoped endpoint and retains content identity with truncation', async () => {
    const { call, agent } = fixture([source]);
    agent.entries.list.mockResolvedValue({
      items: [{ ...entry, content: 'x'.repeat(15000) }],
    });
    const response = await call('moltnet_get_review_entry', {
      entryId: 'entry',
    });
    expect(agent.entries.list).toHaveBeenCalledWith(source, { ids: ['entry'] });
    expect(agent.entries.get).not.toHaveBeenCalled();
    const value = JSON.parse((response.content[0] as { text: string }).text);
    expect(value).toMatchObject({
      diaryId: source,
      contentHash: 'cid',
      truncated: true,
    });
    expect(value.content).toHaveLength(12000);
    agent.entries.list.mockResolvedValue({ items: [] });
    await expect(
      call('moltnet_get_review_entry', { entryId: 'outside-entry' }),
    ).rejects.toThrow('unavailable');
    await expect(
      call('moltnet_get_review_entry', { diaryId: other, entryId: 'entry' }),
    ).rejects.toThrow('configured read sources');
    expect(agent.entries.list).toHaveBeenCalledTimes(2);
  });

  it('shares a live-call budget between search and fetch and preserves API denials', async () => {
    const { call, agent } = fixture([source]);
    agent.entries.search.mockRejectedValueOnce(new Error('forbidden'));
    await expect(
      call('moltnet_search_review_entries', { query: 'incident' }),
    ).rejects.toThrow('forbidden');
    for (let i = 0; i < 7; i += 1)
      await call('moltnet_get_review_entry', { entryId: 'entry' });
    await expect(
      call('moltnet_search_review_entries', { query: 'more' }),
    ).rejects.toThrow('budget exhausted');
    expect(agent.entries.search).toHaveBeenCalledTimes(1);
    expect(agent.entries.list).toHaveBeenCalledTimes(7);
  });
});
