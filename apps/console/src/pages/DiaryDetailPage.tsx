import {
  EntryCard,
  type EntryCardEntry,
  FilterBar,
  parseDiaryFiltersFromQuery,
  serializeDiaryFiltersToQuery,
  useDiaryFilters,
} from '@moltnet/diary-ui';
import { Button, Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';

import { TransferDiaryDialog } from '../components/diaries/TransferDiaryDialog.js';
import {
  SEARCH_LIMIT,
  useDebouncedFilters,
  useDiaryDetails,
  useDiaryTags,
  useEntries,
} from '../diaries/hooks.js';
import { useTeam } from '../team/useTeam.js';

const PAGE_SIZE = 20;

export function DiaryDetailPage({ id }: { id: string }) {
  const theme = useTheme();
  const [, navigate] = useLocation();
  const search = useSearch();

  // URL → local filter state (one-way init + back/forward sync)
  const { state, set, reset } = useDiaryFilters(
    parseDiaryFiltersFromQuery(search),
  );

  useEffect(() => {
    set(parseDiaryFiltersFromQuery(search));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Local state → URL (replace, so we don't pollute history with every keystroke)
  useEffect(() => {
    const qs = serializeDiaryFiltersToQuery(state);
    const current = search ? `?${search}` : '';
    if (qs !== current) {
      navigate(`/diaries/${id}${qs}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, id]);

  const debouncedState = useDebouncedFilters(state);

  const diaryQuery = useDiaryDetails(id);
  const tagsQuery = useDiaryTags(id);
  const entries = useEntries(id, debouncedState, PAGE_SIZE);

  const [transferOpen, setTransferOpen] = useState(false);
  const { teams, callerRoleForTeam } = useTeam();

  const diary = diaryQuery.data;
  const tags = tagsQuery.data ?? [];
  const diaryName = diary?.name ?? 'Diary';
  const diaryVisibility = diary?.visibility ?? 'private';
  const diaryTeamId = diary?.teamId ?? null;

  const sourceTeamRole = diaryTeamId ? callerRoleForTeam(diaryTeamId) : null;
  const canTransferDiary =
    sourceTeamRole === 'owner' || sourceTeamRole === 'manager';

  const hasActiveFilters =
    state.q !== '' ||
    state.tags.length > 0 ||
    state.excludeTags.length > 0 ||
    state.types.length > 0;

  return (
    <Stack gap={6}>
      <Stack
        direction="row"
        justify="space-between"
        align="flex-start"
        gap={4}
        wrap
      >
        <Stack gap={2}>
          <Link
            href="/diaries"
            style={{ color: theme.color.text.muted, textDecoration: 'none' }}
          >
            &larr; Diaries
          </Link>
          <Text variant="h2">{diaryName}</Text>
          <Text color="muted">
            {entries.total} entries · {tags.length} tags · {diaryVisibility}
          </Text>
        </Stack>
        {canTransferDiary && diaryTeamId && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setTransferOpen(true)}
            data-testid="open-transfer-dialog"
          >
            Transfer to team
          </Button>
        )}
      </Stack>

      {diaryTeamId && (
        <TransferDiaryDialog
          open={transferOpen}
          onClose={() => setTransferOpen(false)}
          diaryId={id}
          diaryName={diaryName}
          sourceTeamId={diaryTeamId}
          teams={teams}
        />
      )}

      <FilterBar
        state={state}
        tags={tags}
        resultCount={entries.total}
        onChange={set}
        onExplore={() => navigate(`/diaries/${id}/explore`)}
      />

      <Stack direction="row" gap={2}>
        <Button
          variant={state.view === 'grid' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => set({ ...state, view: 'grid' })}
        >
          Grid
        </Button>
        <Button
          variant={state.view === 'timeline' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => set({ ...state, view: 'timeline' })}
        >
          Timeline
        </Button>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={reset}>
            Reset
          </Button>
        )}
      </Stack>

      {entries.isLoading && entries.items.length === 0 ? (
        <Text color="muted">Loading entries…</Text>
      ) : entries.isError ? (
        <Card style={{ padding: '1.5rem' }}>
          <Text color="muted">Failed to load this diary.</Text>
        </Card>
      ) : entries.items.length === 0 ? (
        <Card style={{ padding: '1.5rem' }}>
          <Stack gap={2}>
            <Text variant="h4">
              {hasActiveFilters ? 'No matching entries' : 'No entries yet'}
            </Text>
            <Text color="muted">
              {hasActiveFilters
                ? 'Clear filters to see the full diary.'
                : 'This diary has no entries yet.'}
            </Text>
          </Stack>
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              state.view === 'grid'
                ? 'repeat(auto-fit, minmax(280px, 1fr))'
                : '1fr',
            gap: theme.spacing[4],
            opacity: entries.isLoading ? 0.6 : 1,
            transition: `opacity ${theme.transition.fast}`,
          }}
        >
          {entries.items.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry as EntryCardEntry}
              view={state.view}
              onOpen={(entryId) =>
                navigate(`/diaries/${id}/entries/${entryId}`)
              }
              onTagClick={(tag) =>
                set({
                  ...state,
                  tags: state.tags.includes(tag)
                    ? state.tags
                    : [...state.tags, tag],
                })
              }
            />
          ))}
        </div>
      )}

      {entries.items.length > 0 && entries.hasNextPage && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={entries.fetchNextPage}
            disabled={entries.isFetchingNextPage}
          >
            {entries.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      {entries.items.length > 0 &&
        state.q !== '' &&
        entries.items.length >= entries.total &&
        entries.total === SEARCH_LIMIT && (
          <Text variant="caption" color="muted">
            Search results capped at {SEARCH_LIMIT}. Refine your query to narrow
            further.
          </Text>
        )}
    </Stack>
  );
}
