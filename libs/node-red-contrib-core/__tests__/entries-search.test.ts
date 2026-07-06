import { describe, expect, it } from 'vitest';

import entriesSearch from '../src/nodes/entries-search.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

describe('moltnet-entries-search', () => {
  it('searches entries with configured filters and snake_case payload overrides', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      entries: {
        search: (body: Record<string, unknown>) => {
          seen.push(body);
          return Promise.resolve({
            total: 1,
            results: [{ id: 'e1', title: 'Decision' }],
          });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(entriesSearch);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).diaryId = 'diary-agent';
    const node = red.create('moltnet-entries-search', 'n1', {
      agent: 'a1',
      query: 'node red',
      tags: 'decision,scope:node-red',
      entryTypes: 'semantic,episodic',
      limit: 10,
      wRelevance: 1,
      wRecency: 0.3,
    });

    const { outputs } = await red.input(node, {
      payload: {
        query: 'tasks list node',
        diary_id: 'diary-override',
        exclude_tags: ['obsolete'],
        exclude_superseded: true,
        w_importance: 0.8,
        w_recency: 0.5,
        w_relevance: 1.2,
      },
    });

    expect(seen).toEqual([
      {
        diaryId: 'diary-override',
        query: 'tasks list node',
        tags: ['decision', 'scope:node-red'],
        excludeTags: ['obsolete'],
        entryTypes: ['semantic', 'episodic'],
        excludeSuperseded: true,
        limit: 10,
        wImportance: 0.8,
        wRelevance: 1.2,
        wRecency: 0.5,
      },
    ]);
    expect(outputs[0].payload).toEqual([{ id: 'e1', title: 'Decision' }]);
    expect(outputs[0].entries).toEqual({ total: 1, query: seen[0] });
  });

  it('treats a string payload as the query', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      entries: {
        search: (body: Record<string, unknown>) => {
          seen.push(body);
          return Promise.resolve({ total: 0, results: [] });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(entriesSearch);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).diaryId = 'diary-agent';
    const node = red.create('moltnet-entries-search', 'n1', { agent: 'a1' });

    await red.input(node, { payload: 'release rationale' });

    expect(seen).toEqual([
      { diaryId: 'diary-agent', query: 'release rationale' },
    ]);
  });

  it('errors when no query can be resolved', async () => {
    const red = new FakeRed();
    red.load(agentStub({ entries: { search: () => Promise.resolve({}) } }));
    red.load(entriesSearch);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-entries-search', 'n1', { agent: 'a1' });

    await expect(red.input(node, {})).rejects.toThrow(/query is required/);
  });
});
