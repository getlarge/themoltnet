import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestWrapper } from './test-query-client.js';

const mockListDiaries = vi.fn();
const mockListDiaryEntries = vi.fn();
const mockListDiaryTags = vi.fn();

vi.mock('@moltnet/api-client', () => ({
  listDiaries: (...args: unknown[]) => mockListDiaries(...args),
  listDiaryEntries: (...args: unknown[]) => mockListDiaryEntries(...args),
  listDiaryTags: (...args: unknown[]) => mockListDiaryTags(...args),
  // Generated *Options helpers from @moltnet/api-client/query are imported
  // into hooks.ts but not exercised by useDiarySummaries — stubs are enough
  // to avoid the resolver erroring.
  searchDiary: vi.fn(),
}));

vi.mock('@moltnet/api-client/query', () => ({
  getDiaryOptions: vi.fn(() => ({
    queryKey: ['getDiary'],
    queryFn: vi.fn(),
  })),
  getDiaryEntryByIdOptions: vi.fn(() => ({
    queryKey: ['getDiaryEntryById'],
    queryFn: vi.fn(),
  })),
  listDiaryEntriesInfiniteOptions: vi.fn(() => ({
    queryKey: ['listDiaryEntries'],
    queryFn: vi.fn(),
  })),
  listDiaryTagsOptions: vi.fn(() => ({
    queryKey: ['listDiaryTags'],
    queryFn: vi.fn(),
  })),
  verifyDiaryEntryByIdOptions: vi.fn(() => ({
    queryKey: ['verifyDiaryEntryById'],
    queryFn: vi.fn(),
  })),
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({}),
}));

import { useDiarySummaries } from '../src/diaries/hooks.js';

describe('useDiarySummaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDiaryEntries.mockResolvedValue({
      data: { items: [], total: 0 },
    });
    mockListDiaryTags.mockResolvedValue({
      data: { tags: [], total: 0 },
    });
  });

  it('forwards x-moltnet-team-id header when teamId is provided', async () => {
    mockListDiaries.mockResolvedValue({ data: { items: [] } });

    const { result } = renderHook(() => useDiarySummaries('team-alpha'), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockListDiaries).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-moltnet-team-id': 'team-alpha' },
      }),
    );
  });

  it('omits the team header when teamId is null', async () => {
    mockListDiaries.mockResolvedValue({ data: { items: [] } });

    const { result } = renderHook(() => useDiarySummaries(null), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockListDiaries).toHaveBeenCalledWith(
      expect.objectContaining({ headers: undefined }),
    );
  });

  it('aggregates entryCount, tagCount, and latestEntryAt per diary', async () => {
    mockListDiaries.mockResolvedValue({
      data: {
        items: [
          {
            id: 'd1',
            name: 'b-diary',
            visibility: 'private',
            teamId: 't1',
          },
          {
            id: 'd2',
            name: 'a-diary',
            visibility: 'private',
            teamId: 't1',
          },
        ],
      },
    });

    mockListDiaryEntries.mockImplementation(
      ({ path }: { path: { diaryId: string } }) => {
        if (path.diaryId === 'd1') {
          return Promise.resolve({
            data: {
              items: [{ createdAt: '2026-05-22T10:00:00Z' }],
              total: 5,
            },
          });
        }
        return Promise.resolve({
          data: { items: [], total: 0 },
        });
      },
    );

    mockListDiaryTags.mockImplementation(
      ({ path }: { path: { diaryId: string } }) => {
        if (path.diaryId === 'd1') {
          return Promise.resolve({
            data: {
              tags: [
                { tag: 'auth', count: 3 },
                { tag: 'db', count: 2 },
              ],
              total: 2,
            },
          });
        }
        return Promise.resolve({ data: { tags: [], total: 0 } });
      },
    );

    const { result } = renderHook(() => useDiarySummaries('t1'), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const summaries = result.current.data ?? [];
    // d1 has the most-recent latestEntryAt → sorts before d2.
    expect(summaries.map((s) => s.id)).toEqual(['d1', 'd2']);
    expect(summaries[0]).toMatchObject({
      id: 'd1',
      entryCount: 5,
      tagCount: 2,
      latestEntryAt: '2026-05-22T10:00:00Z',
    });
    expect(summaries[1]).toMatchObject({
      id: 'd2',
      entryCount: 0,
      tagCount: 0,
      latestEntryAt: null,
    });
  });
});
