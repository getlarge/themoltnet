import { describe, expect, it } from 'vitest';

import {
  McpDiaryAdapter,
  parseToolJson,
  type ToolCaller,
} from './mcp-adapter.js';

/** Returns a tool result in the `content[].text` JSON shape the host delivers. */
function textResult(payload: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function caller(impl: ToolCaller['callServerTool']): {
  app: ToolCaller;
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
} {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const app: ToolCaller = {
    callServerTool: (input) => {
      calls.push(input);
      return impl(input);
    },
  };
  return { app, calls };
}

describe('parseToolJson', () => {
  it('reads the text content block first', () => {
    expect(parseToolJson(textResult({ total: 7 }))).toEqual({ total: 7 });
  });

  it('falls back to structuredContent when there is no text block', () => {
    expect(parseToolJson({ structuredContent: { total: 3 } })).toEqual({
      total: 3,
    });
  });

  it('falls back to structuredContent when text is not valid JSON', () => {
    expect(
      parseToolJson({
        content: [{ type: 'text', text: 'not json' }],
        structuredContent: { ok: true },
      }),
    ).toEqual({ ok: true });
  });

  it('returns {} for junk', () => {
    expect(parseToolJson(undefined)).toEqual({});
    expect(parseToolJson(42)).toEqual({});
  });
});

describe('McpDiaryAdapter.listEntries', () => {
  it('maps camelCase args to snake_case tool args and drops undefined', async () => {
    const { app, calls } = caller(() =>
      Promise.resolve(
        textResult({ items: [], total: 5, limit: 20, offset: 0 }),
      ),
    );
    const adapter = new McpDiaryAdapter(app);

    const out = await adapter.listEntries({
      diaryId: 'd1',
      limit: 20,
      tags: ['scope:auth'],
    });

    expect(calls[0].name).toBe('entries_list');
    expect(calls[0].arguments).toEqual({
      diary_id: 'd1',
      limit: 20,
      tags: ['scope:auth'],
    });
    expect(calls[0].arguments).not.toHaveProperty('offset');
    expect(out.total).toBe(5);
  });
});

describe('McpDiaryAdapter.searchEntries', () => {
  it('passes query + weights as snake_case and returns results', async () => {
    const { app, calls } = caller(() =>
      Promise.resolve(textResult({ results: [{ id: 'e1' }], total: 1 })),
    );
    const adapter = new McpDiaryAdapter(app);

    const out = await adapter.searchEntries({
      diaryId: 'd1',
      query: 'autonomy',
      wRecency: 0.3,
    });

    expect(calls[0].name).toBe('entries_search');
    expect(calls[0].arguments).toMatchObject({
      diary_id: 'd1',
      query: 'autonomy',
      w_recency: 0.3,
    });
    expect(out.results).toHaveLength(1);
  });
});

describe('McpDiaryAdapter.listTags', () => {
  it('normalizes the tag cloud and skips malformed entries', async () => {
    const { app } = caller(() =>
      Promise.resolve(
        textResult({
          tags: [{ tag: 'auth', count: 9 }, { count: 1 }],
          total: 1,
        }),
      ),
    );
    const adapter = new McpDiaryAdapter(app);

    const out = await adapter.listTags('d1');

    expect(out).toEqual([{ tag: 'auth', count: 9 }]);
  });
});

describe('McpDiaryAdapter.createZonePack', () => {
  it('creates an UNPINNED pack with provenance, then resolves its id from the CID', async () => {
    // packs_create returns only packCid (no id); the adapter resolves the UUID
    // via packs_provenance (metadata.rootPackId), not a paginated packs_list.
    const { app, calls } = caller((input) => {
      if (input.name === 'packs_create') {
        return Promise.resolve(textResult({ packCid: 'bafy-zone' }));
      }
      if (input.name === 'packs_provenance') {
        return Promise.resolve(
          textResult({ metadata: { rootPackId: 'pack-1' } }),
        );
      }
      return Promise.resolve(textResult({}));
    });
    const adapter = new McpDiaryAdapter(app);

    const draft = await adapter.createZonePack({
      diaryId: 'd1',
      label: 'Auth decisions',
      entryIds: ['e2', 'e1'],
      provenance: {
        basis: 'tag:auth + recent',
        searches: [{ query: 'keto', tags: ['scope:auth'] }],
      },
    });

    expect(calls[0].name).toBe('packs_create');
    expect(calls[0].arguments).toMatchObject({
      diary_id: 'd1',
      pinned: false,
      params: {
        kind: 'diary-map-zone',
        status: 'draft',
        label: 'Auth decisions',
        basis: 'tag:auth + recent',
        searches: [{ query: 'keto', tags: ['scope:auth'] }],
      },
    });
    // Ranks are 1-based and follow the given order.
    expect(calls[0].arguments.entries).toEqual([
      { entry_id: 'e2', rank: 1 },
      { entry_id: 'e1', rank: 2 },
    ]);
    // The UUID is resolved deterministically from the CID via provenance.
    expect(calls[1].name).toBe('packs_provenance');
    expect(calls[1].arguments).toMatchObject({ pack_cid: 'bafy-zone' });
    expect(draft).toEqual({
      packId: 'pack-1',
      packCid: 'bafy-zone',
      pinned: false,
    });
  });

  it('returns an empty packId when packs_create yields no CID (no provenance call)', async () => {
    const { app, calls } = caller((input) => {
      if (input.name === 'packs_create') {
        return Promise.resolve(textResult({}));
      }
      return Promise.resolve(textResult({}));
    });
    const adapter = new McpDiaryAdapter(app);

    const draft = await adapter.createZonePack({
      diaryId: 'd1',
      label: 'X',
      entryIds: ['e1'],
      provenance: { basis: 'x', searches: [] },
    });

    expect(draft.packId).toBe('');
    // No CID -> we never attempt provenance resolution.
    expect(calls.some((c) => c.name === 'packs_provenance')).toBe(false);
  });
});

describe('McpDiaryAdapter.setZonePinned', () => {
  it('pins without an expiry', async () => {
    const { app, calls } = caller(() => Promise.resolve(textResult({})));
    const adapter = new McpDiaryAdapter(app);

    await adapter.setZonePinned('pack-1', true);

    expect(calls[0].name).toBe('packs_update');
    expect(calls[0].arguments).toEqual({ pack_id: 'pack-1', pinned: true });
  });

  it('unpinning supplies a future expiry (required by the server)', async () => {
    const { app, calls } = caller(() => Promise.resolve(textResult({})));
    const adapter = new McpDiaryAdapter(app);

    await adapter.setZonePinned('pack-1', false);

    expect(calls[0].arguments.pinned).toBe(false);
    expect(typeof calls[0].arguments.expires_at).toBe('string');
    expect(
      new Date(calls[0].arguments.expires_at as string).getTime(),
    ).toBeGreaterThan(Date.now());
  });
});
