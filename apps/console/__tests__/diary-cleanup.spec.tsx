import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiaryDetailPage } from '../src/pages/DiaryDetailPage.js';

const batchDeleteDiaryEntries = vi.fn();
const refetchEntries = vi.fn();
const navigate = vi.fn();

vi.mock('@moltnet/api-client', () => ({
  batchDeleteDiaryEntries: (...args: unknown[]) =>
    batchDeleteDiaryEntries(...args),
}));

vi.mock('@moltnet/diary-ui', () => ({
  EntryCard: ({
    entry,
    onOpen,
  }: {
    entry: { id: string; title: string };
    onOpen: (id: string) => void;
  }) => (
    <button type="button" onClick={() => onOpen(entry.id)}>
      {entry.title}
    </button>
  ),
  FilterBar: () => <div data-testid="filter-bar" />,
  parseDiaryFiltersFromQuery: () => ({
    q: '',
    tags: [],
    excludeTags: [],
    types: [],
    view: 'grid',
  }),
  serializeDiaryFiltersToQuery: () => '',
  useDiaryFilters: (initial: unknown) => ({
    state: initial,
    set: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('wouter', () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ['/diaries/d1', navigate],
  useSearch: () => '',
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({}),
}));

vi.mock('../src/components/diaries/TransferDiaryDialog.js', () => ({
  TransferDiaryDialog: () => null,
}));

vi.mock('../src/diaries/hooks.js', () => ({
  SEARCH_LIMIT: 100,
  useDebouncedFilters: (state: unknown) => state,
  useDiaryDetails: () => ({
    data: {
      id: 'd1',
      name: 'Diary',
      teamId: 'team-1',
      visibility: 'private',
    },
  }),
  useDiaryTags: () => ({ data: [] }),
  useEntries: () => ({
    items: [
      { id: 'entry-1', title: 'Noise one' },
      { id: 'entry-2', title: 'Noise two' },
    ],
    total: 2,
    isLoading: false,
    isFetching: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: refetchEntries,
    isFetchingNextPage: false,
  }),
}));

vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({
    callerRoleForTeam: () => 'owner',
    teams: [{ id: 'team-1', name: 'team-1' }],
  }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <MoltThemeProvider mode="dark">{children}</MoltThemeProvider>;
}

describe('DiaryDetailPage cleanup', () => {
  beforeEach(() => {
    batchDeleteDiaryEntries.mockReset();
    batchDeleteDiaryEntries.mockResolvedValue({
      data: { deleted: ['entry-1'], skipped: ['entry-2'] },
    });
    refetchEntries.mockReset();
    refetchEntries.mockResolvedValue({});
    navigate.mockReset();
  });

  it('selects visible entries and deletes them through the batch endpoint', async () => {
    render(<DiaryDetailPage id="d1" />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole('button', { name: 'Select visible' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    expect(screen.getByText(/Signed, unauthorized/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(batchDeleteDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { ids: ['entry-1', 'entry-2'] },
        }),
      );
    });
    expect(refetchEntries).toHaveBeenCalled();
    expect(await screen.findByText('1 deleted, 1 skipped')).toBeInTheDocument();
  });
});
