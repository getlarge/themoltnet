import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListDiaries = vi.fn();
const mockListDiaryEntries = vi.fn();
const mockListDiaryTags = vi.fn();

vi.mock('@moltnet/api-client', () => ({
  listDiaries: (...args: unknown[]) => mockListDiaries(...args),
  listDiaryEntries: (...args: unknown[]) => mockListDiaryEntries(...args),
  listDiaryTags: (...args: unknown[]) => mockListDiaryTags(...args),
  getDiary: vi.fn(),
  getDiaryEntryById: vi.fn(),
  verifyDiaryEntryById: vi.fn(),
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({}),
}));

import { fetchDiarySummaries } from '../src/diaries/api.js';

describe('fetchDiarySummaries', () => {
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

    await fetchDiarySummaries('team-alpha');

    expect(mockListDiaries).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-moltnet-team-id': 'team-alpha' },
      }),
    );
  });

  it('omits the team header when teamId is null', async () => {
    mockListDiaries.mockResolvedValue({ data: { items: [] } });

    await fetchDiarySummaries(null);

    expect(mockListDiaries).toHaveBeenCalledWith(
      expect.objectContaining({ headers: undefined }),
    );
  });

  it('omits the team header when teamId is undefined', async () => {
    mockListDiaries.mockResolvedValue({ data: { items: [] } });

    await fetchDiarySummaries();

    expect(mockListDiaries).toHaveBeenCalledWith(
      expect.objectContaining({ headers: undefined }),
    );
  });
});
