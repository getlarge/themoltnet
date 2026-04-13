import type { DiaryEntry } from '@moltnet/api-client';
import { Button, Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';

import { EntryCard } from '../components/diaries/EntryCard.js';
import { TagCloud,type TagCloudItem } from '../components/diaries/TagCloud.js';
import { fetchDiaryDetails, fetchDiaryEntries, fetchDiaryTagCloud } from '../diaries/api.js';
import {
  buildDiaryQuery,
  type EntryType,
  formatRelativeTime,
  getEntryTypeQuery,
} from '../diaries/utils.js';

const PAGE_SIZE = 20;

export function DiaryDetailPage({ id }: { id: string }) {
  const theme = useTheme();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const activeTag = params.get('tag');
  const activeType = getEntryTypeQuery(params.get('type'));
  const view = params.get('view') === 'timeline' ? 'timeline' : 'grid';

  const [diaryName, setDiaryName] = useState<string>('Diary');
  const [diaryVisibility, setDiaryVisibility] = useState<string>('private');
  const [entries, setEntries] = useState<Array<DiaryEntry>>([]);
  const [total, setTotal] = useState(0);
  const [tags, setTags] = useState<Array<TagCloudItem>>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  function updateFilters(next: {
    tag?: string | null;
    type?: EntryType | null;
    view?: 'grid' | 'timeline' | null;
  }) {
    const hasTag = Object.prototype.hasOwnProperty.call(next, 'tag');
    const hasType = Object.prototype.hasOwnProperty.call(next, 'type');
    const hasView = Object.prototype.hasOwnProperty.call(next, 'view');

    navigate(
      `/diaries/${id}${buildDiaryQuery({
        tag: hasTag ? next.tag ?? null : activeTag,
        type: hasType ? next.type ?? null : activeType,
        view: hasView ? next.view ?? null : view,
      })}`,
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function loadMeta() {
      try {
        const [diary, diaryTags] = await Promise.all([
          fetchDiaryDetails(id),
          fetchDiaryTagCloud(id),
        ]);

        if (cancelled) return;
        setDiaryName(diary.name);
        setDiaryVisibility(diary.visibility);
        setTags(diaryTags);
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    void loadMeta();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    async function loadEntries() {
      setStatus('loading');

      try {
        const response = await fetchDiaryEntries({
          diaryId: id,
          limit: PAGE_SIZE,
          offset: 0,
          tag: activeTag,
          entryType: activeType,
        });

        if (cancelled) return;
        setEntries(response.items);
        setTotal(response.total);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    void loadEntries();
    return () => {
      cancelled = true;
    };
  }, [activeTag, activeType, id]);

  async function loadMore() {
    setIsLoadingMore(true);

    try {
      const response = await fetchDiaryEntries({
        diaryId: id,
        limit: PAGE_SIZE,
        offset: entries.length,
        tag: activeTag,
        entryType: activeType,
      });

      setEntries((current) => [...current, ...response.items]);
      setTotal(response.total);
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Link
          href="/diaries"
          style={{ color: theme.color.text.muted, textDecoration: 'none' }}
        >
          &larr; Diaries
        </Link>
        <Text variant="h2">{diaryName}</Text>
        <Text color="muted">
          {total} entries · {tags.length} tags · {diaryVisibility}
        </Text>
      </Stack>

      <Card variant="surface" padding="md">
        <Stack gap={3}>
          <Text variant="h4">Tags</Text>
          <TagCloud
            items={tags}
            activeTag={activeTag}
            onTagClick={(tag) => updateFilters({ tag })}
          />
        </Stack>
      </Card>

      <Stack
        direction="row"
        align="center"
        justify="space-between"
        gap={4}
        wrap
      >
        <Stack direction="row" gap={2}>
          <FilterButton
            active={view === 'grid'}
            onClick={() => updateFilters({ view: 'grid' })}
          >
            Grid
          </FilterButton>
          <FilterButton
            active={view === 'timeline'}
            onClick={() => updateFilters({ view: 'timeline' })}
          >
            Timeline
          </FilterButton>
        </Stack>

        <Stack direction="row" gap={2} wrap>
          <FilterButton
            active={!activeType}
            onClick={() => updateFilters({ type: null })}
          >
            All types
          </FilterButton>
          {(['procedural', 'semantic', 'episodic'] as Array<EntryType>).map(
            (type) => (
              <FilterButton
                key={type}
                active={activeType === type}
                onClick={() => updateFilters({ type })}
              >
                {type}
              </FilterButton>
            ),
          )}
        </Stack>
      </Stack>

      {status === 'loading' ? (
        <Text color="muted">Loading entries…</Text>
      ) : status === 'error' ? (
        <Card style={{ padding: '1.5rem' }}>
          <Text color="muted">Failed to load this diary.</Text>
        </Card>
      ) : entries.length === 0 ? (
        <Card style={{ padding: '1.5rem' }}>
          <Stack gap={2}>
            <Text variant="h4">
              {activeTag || activeType ? 'No matching entries' : 'No entries yet'}
            </Text>
            <Text color="muted">
              {activeTag || activeType
                ? 'Clear filters to see the full diary.'
                : 'This diary has no entries yet.'}
            </Text>
          </Stack>
        </Card>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                view === 'grid'
                  ? 'repeat(auto-fit, minmax(280px, 1fr))'
                  : '1fr',
              gap: theme.spacing[4],
            }}
          >
            {entries.map((entry) => (
              <EntryCard
                key={entry.id}
                diaryId={id}
                entry={entry}
                view={view}
                onTagClick={(tag) => updateFilters({ tag })}
              />
            ))}
          </div>

          {entries.length < total && (
            <Button variant="secondary" onClick={loadMore} disabled={isLoadingMore}>
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}

          <Text variant="caption" color="muted">
            Latest visible entry: {formatRelativeTime(entries[0]?.createdAt ?? null)}
          </Text>
        </>
      )}
    </Stack>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button variant={active ? 'primary' : 'ghost'} size="sm" onClick={onClick}>
      {children}
    </Button>
  );
}
