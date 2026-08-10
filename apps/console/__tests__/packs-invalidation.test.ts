/**
 * Contract-level cover for the pack mutations.
 *
 * Unlike packs-api.test.ts, this file does NOT mock
 * `@moltnet/api-client/query`. It uses the real generated key factories and a
 * real QueryClient, so generated-key drift (or a deleted onSuccess) fails here
 * instead of passing against hand-built keys.
 */
import {
  getContextPackProvenanceByCidQueryKey,
  getRenderedPackByIdOptions,
  listContextPacksQueryKey,
  listDiaryPacksQueryKey,
  listDiaryRenderedPacksQueryKey,
} from '@moltnet/api-client/query';
import { QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestWrapper } from './test-query-client.js';

const mocks = vi.hoisted(() => ({
  updateContextPack: vi.fn(),
  updateRenderedPack: vi.fn(),
}));

vi.mock('@moltnet/api-client', () => ({
  updateContextPack: (...args: unknown[]) => mocks.updateContextPack(...args),
  updateRenderedPack: (...args: unknown[]) => mocks.updateRenderedPack(...args),
}));

const TEST_CLIENT = {
  getConfig: () => ({ baseUrl: 'http://console.test' }),
};

vi.mock('../src/api.js', () => ({ getApiClient: () => TEST_CLIENT }));

const teamMock = vi.hoisted(() => ({
  selectedTeam: null as { id: string } | null,
}));
vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({ selectedTeam: teamMock.selectedTeam }),
}));

import {
  PackMutationError,
  useDiaryPacks,
  useDiaryRenderedPacks,
  usePack,
  usePackProvenance,
  usePackWithEntries,
  usePinPack,
  usePinRenderedPack,
  useRenderedPack,
} from '../src/packs/hooks.js';

const asClient = TEST_CLIENT as unknown as Parameters<
  typeof listDiaryPacksQueryKey
>[0]['client'];

const PACK_KEY = listDiaryPacksQueryKey({
  client: asClient,
  path: { id: 'diary-1' },
});
const COMBINED_KEY = listContextPacksQueryKey({
  client: asClient,
  query: { includeRendered: true },
});
const RENDERED_KEY = listDiaryRenderedPacksQueryKey({
  client: asClient,
  path: { id: 'diary-1' },
});
const CID_PROVENANCE_KEY = getContextPackProvenanceByCidQueryKey({
  client: asClient,
  path: { cid: 'bafy-test' },
});
const UNRELATED_KEY = ['diaries', 'summaries', null];

function seed(queryClient: QueryClient) {
  queryClient.setQueryData(PACK_KEY, { items: [], total: 0 });
  queryClient.setQueryData(COMBINED_KEY, { items: [], total: 0 });
  queryClient.setQueryData(RENDERED_KEY, { items: [], total: 0 });
  queryClient.setQueryData(CID_PROVENANCE_KEY, { nodes: [], edges: [] });
  queryClient.setQueryData(UNRELATED_KEY, [{ id: 'diary-1' }]);
}

const invalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
  queryClient.getQueryState(key)?.isInvalidated === true;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateContextPack.mockResolvedValue({ data: { id: 'pack-1' } });
  mocks.updateRenderedPack.mockResolvedValue({ data: { id: 'rendered-1' } });
});

describe('the generated key factories still produce the shape the predicates match', () => {
  it('wraps the discriminator in an object, not a bare string', () => {
    expect(PACK_KEY[0]).toMatchObject({ _id: 'listDiaryPacks' });
    expect(RENDERED_KEY[0]).toMatchObject({ _id: 'listDiaryRenderedPacks' });
    expect(
      getRenderedPackByIdOptions({ client: asClient, path: { id: 'r1' } })
        .queryKey[0],
    ).toMatchObject({ _id: 'getRenderedPackById' });
  });
});

describe('usePinPack payload', () => {
  it('sends only pinned when pinning', async () => {
    const { result } = renderHook(() => usePinPack(), {
      wrapper: createTestWrapper(),
    });

    result.current.mutate({ packId: 'pack-1', pinned: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.updateContextPack).toHaveBeenCalledWith(
      expect.objectContaining({ body: { pinned: true } }),
    );
  });

  it('supplies a future expiresAt when unpinning, which the API requires', async () => {
    const { result } = renderHook(() => usePinPack(), {
      wrapper: createTestWrapper(),
    });

    result.current.mutate({ packId: 'pack-1', pinned: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const body = mocks.updateContextPack.mock.calls[0][0].body as {
      pinned: boolean;
      expiresAt: string;
    };
    expect(body.pinned).toBe(false);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('honours an explicit expiresAt', async () => {
    const explicit = new Date(Date.now() + 86_400_000).toISOString();
    const { result } = renderHook(() => usePinPack(), {
      wrapper: createTestWrapper(),
    });

    result.current.mutate({
      packId: 'pack-1',
      pinned: false,
      expiresAt: explicit,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.updateContextPack).toHaveBeenCalledWith(
      expect.objectContaining({ body: { pinned: false, expiresAt: explicit } }),
    );
  });

  it('rethrows the structured API error rather than flattening it', async () => {
    const problem = { title: 'Forbidden', status: 403 };
    mocks.updateContextPack.mockResolvedValue({ error: problem });

    const { result } = renderHook(() => usePinPack(), {
      wrapper: createTestWrapper(),
    });

    result.current.mutate({ packId: 'pack-1', pinned: true });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(PackMutationError);
    expect((result.current.error as PackMutationError).problem).toEqual(
      problem,
    );
    expect(result.current.error?.message).toBe('Forbidden');
  });
});

describe('usePinRenderedPack payload', () => {
  it('supplies a future expiresAt when unpinning', async () => {
    const { result } = renderHook(() => usePinRenderedPack(), {
      wrapper: createTestWrapper(),
    });

    result.current.mutate({ renderedPackId: 'rendered-1', pinned: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const body = mocks.updateRenderedPack.mock.calls[0][0].body as {
      pinned: boolean;
      expiresAt: string;
    };
    expect(body.pinned).toBe(false);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rethrows the structured API error', async () => {
    const problem = { title: 'Not Found', status: 404 };
    mocks.updateRenderedPack.mockResolvedValue({ error: problem });

    const { result } = renderHook(() => usePinRenderedPack(), {
      wrapper: createTestWrapper(),
    });

    result.current.mutate({ renderedPackId: 'rendered-1', pinned: true });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as PackMutationError).problem).toEqual(
      problem,
    );
  });
});

describe('invalidation against real cached queries', () => {
  it('flips pack queries and leaves unrelated caches alone', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    seed(queryClient);

    const { result } = renderHook(() => usePinPack(), {
      wrapper: createTestWrapper(queryClient),
    });

    result.current.mutate({ packId: 'pack-1', pinned: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(invalidated(queryClient, PACK_KEY)).toBe(true));

    expect(invalidated(queryClient, COMBINED_KEY)).toBe(true);
    // Provenance meta carries pinned/expiresAt, so the by-CID graph is stale too.
    expect(invalidated(queryClient, CID_PROVENANCE_KEY)).toBe(true);
    expect(invalidated(queryClient, UNRELATED_KEY)).toBe(false);
  });

  it('flips the combined context-pack query after a rendered-pack pin', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    seed(queryClient);

    const { result } = renderHook(() => usePinRenderedPack(), {
      wrapper: createTestWrapper(queryClient),
    });

    result.current.mutate({ renderedPackId: 'rendered-1', pinned: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect(invalidated(queryClient, RENDERED_KEY)).toBe(true),
    );

    // GET /packs?includeRendered=true embeds rendered packs, so it must not
    // survive a rendered-pack mutation. Provenance embeds rendered-pack
    // pinned/expiresAt too.
    expect(invalidated(queryClient, COMBINED_KEY)).toBe(true);
    expect(invalidated(queryClient, CID_PROVENANCE_KEY)).toBe(true);
    expect(invalidated(queryClient, UNRELATED_KEY)).toBe(false);
  });
});

describe('team scoping', () => {
  // Every query hook must pass the team header into its own generated options
  // call — the client's default header does not reach the key. Table-driven so
  // dropping `headers` from any single hook fails here.
  const HOOKS: Array<[string, () => unknown]> = [
    ['useDiaryPacks', () => useDiaryPacks('diary-1')],
    ['usePack', () => usePack('pack-1')],
    ['usePackWithEntries', () => usePackWithEntries('pack-1')],
    ['usePackProvenance', () => usePackProvenance('pack-1')],
    ['useDiaryRenderedPacks', () => useDiaryRenderedPacks('diary-1')],
    ['useRenderedPack', () => useRenderedPack('rendered-1')],
  ];

  const keyFor = async (hook: () => unknown, teamId: string | null) => {
    teamMock.selectedTeam = teamId ? { id: teamId } : null;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderHook(hook, { wrapper: createTestWrapper(queryClient) });
    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll().length).toBe(1),
    );
    return JSON.stringify(queryClient.getQueryCache().getAll()[0].queryKey);
  };

  it.each(HOOKS)(
    '%s gives two teams different cache keys',
    async (_name, hook) => {
      const a = await keyFor(hook, 'team-a');
      const b = await keyFor(hook, 'team-b');

      expect(a).not.toBe(b);
      expect(a).toContain('team-a');
      expect(b).toContain('team-b');
    },
  );

  it.each(HOOKS)(
    '%s omits the header entirely when no team is selected',
    async (_name, hook) => {
      const key = await keyFor(hook, null);
      expect(key).not.toContain('x-moltnet-team-id');
    },
  );
});
