import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestWrapper } from './test-query-client.js';

const mocks = vi.hoisted(() => ({
  listDiaryPacks: vi.fn(),
  getContextPackById: vi.fn(),
  updateContextPack: vi.fn(),
  updateRenderedPack: vi.fn(),
}));

// The generated *Options factories build their key with createQueryKey(), which
// produces a single-element array holding an object: [{ _id, baseUrl, path,
// query }]. These stubs reproduce that shape so the invalidation predicates are
// exercised against a realistic key, not a plain string array.
vi.mock('@moltnet/api-client/query', () => ({
  listDiaryPacksOptions: (options: { path: { id: string } }) => ({
    queryKey: [{ _id: 'listDiaryPacks', path: options.path }],
    queryFn: () => mocks.listDiaryPacks(options),
  }),
  getContextPackByIdOptions: (options: {
    path: { id: string };
    query?: { expand?: string };
  }) => ({
    queryKey: [
      { _id: 'getContextPackById', path: options.path, query: options.query },
    ],
    queryFn: () => mocks.getContextPackById(options),
  }),
  getContextPackProvenanceByIdOptions: (options: { path: { id: string } }) => ({
    queryKey: [{ _id: 'getContextPackProvenanceById', path: options.path }],
    queryFn: vi.fn(),
  }),
  listDiaryRenderedPacksOptions: (options: { path: { id: string } }) => ({
    queryKey: [{ _id: 'listDiaryRenderedPacks', path: options.path }],
    queryFn: vi.fn(),
  }),
  getRenderedPackByIdOptions: (options: { path: { id: string } }) => ({
    queryKey: [{ _id: 'getRenderedPackById', path: options.path }],
    queryFn: vi.fn(),
  }),
}));

vi.mock('@moltnet/api-client', () => ({
  updateContextPack: (...args: unknown[]) => mocks.updateContextPack(...args),
  updateRenderedPack: (...args: unknown[]) => mocks.updateRenderedPack(...args),
}));

vi.mock('../src/api.js', () => ({ getApiClient: () => ({}) }));

import {
  isPackQueryKey,
  isRenderedPackQueryKey,
  useDiaryPacks,
  usePackWithEntries,
  usePinPack,
} from '../src/packs/hooks.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDiaryPacks', () => {
  it('returns the pack list for a diary', async () => {
    mocks.listDiaryPacks.mockResolvedValue({
      items: [{ id: 'pack-1', pinned: true }],
      total: 1,
    });

    const { result } = renderHook(() => useDiaryPacks('diary-1'), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toHaveLength(1);
  });

  it('stays disabled without a diary id', () => {
    const { result } = renderHook(() => useDiaryPacks(''), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.listDiaryPacks).not.toHaveBeenCalled();
  });
});

describe('usePackWithEntries', () => {
  it('requests the entries expansion for a single pack', async () => {
    mocks.getContextPackById.mockResolvedValue({ id: 'pack-1', entries: [] });

    const { result } = renderHook(() => usePackWithEntries('pack-1'), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.getContextPackById).toHaveBeenCalledWith(
      expect.objectContaining({ query: { expand: 'entries' } }),
    );
  });
});

describe('usePinPack', () => {
  it('sends the requested pin state', async () => {
    mocks.updateContextPack.mockResolvedValue({
      data: { id: 'pack-1', pinned: true },
    });

    const { result } = renderHook(() => usePinPack(), {
      wrapper: createTestWrapper(),
    });

    result.current.mutate({ packId: 'pack-1', pinned: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.updateContextPack).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 'pack-1' },
        body: { pinned: true },
      }),
    );
  });

  it('surfaces an API error instead of resolving silently', async () => {
    mocks.updateContextPack.mockResolvedValue({
      error: { title: 'Forbidden' },
    });

    const { result } = renderHook(() => usePinPack(), {
      wrapper: createTestWrapper(),
    });

    result.current.mutate({ packId: 'pack-1', pinned: true });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('query key predicates', () => {
  it('matches the generated object key shape, not a bare string array', () => {
    expect(
      isPackQueryKey([{ _id: 'listDiaryPacks', path: { id: 'd1' } }]),
    ).toBe(true);
    expect(isPackQueryKey([{ _id: 'getContextPackById' }])).toBe(true);
    // A bare string array is what a naive invalidateQueries call would use;
    // it must not be treated as a match, because the generated keys never
    // take that shape.
    expect(isPackQueryKey(['listDiaryPacks'])).toBe(false);
  });

  it('separates rendered pack keys from context pack keys', () => {
    expect(isRenderedPackQueryKey([{ _id: 'getRenderedPackById' }])).toBe(true);
    expect(isRenderedPackQueryKey([{ _id: 'listDiaryRenderedPacks' }])).toBe(
      true,
    );
    expect(isRenderedPackQueryKey([{ _id: 'listDiaryPacks' }])).toBe(false);
    expect(isPackQueryKey([{ _id: 'getRenderedPackById' }])).toBe(false);
  });
});
