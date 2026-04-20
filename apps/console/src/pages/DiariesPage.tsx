import { useQuery } from '@tanstack/react-query';
import { Button, Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { type ChangeEvent, useMemo, useState } from 'react';

import { DiaryCard } from '../components/diaries/DiaryCard.js';
import { fetchDiarySummaries } from '../diaries/api.js';
import { useTeam } from '../team/useTeam.js';

export function DiariesPage() {
  const theme = useTheme();
  const { error: teamError, refreshTeams, selectedTeam } = useTeam();
  const [query, setQuery] = useState('');
  const {
    data: diaries = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['diaries', 'summaries', selectedTeam?.id ?? null],
    queryFn: () => fetchDiarySummaries(selectedTeam?.id ?? null),
  });

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return diaries;

    return diaries.filter((diary) =>
      [diary.name, diary.id, diary.visibility].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [diaries, query]);

  return (
    <Stack gap={6}>
      <Stack
        direction="row"
        align="center"
        justify="space-between"
        gap={4}
        wrap
      >
        <Stack gap={1}>
          <Text variant="h2">Diaries</Text>
          <Text color="muted">
            Browse every diary available in the current team scope.
          </Text>
        </Stack>

        <input
          type="search"
          value={query}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setQuery(event.target.value)
          }
          placeholder="Search diaries"
          aria-label="Search diaries"
          style={{
            minWidth: 260,
            padding: `${theme.spacing[3]} ${theme.spacing[4]}`,
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.color.border.DEFAULT}`,
            background: theme.color.bg.surface,
            color: theme.color.text.DEFAULT,
            fontFamily: theme.font.family.sans,
            fontSize: theme.font.size.sm,
          }}
        />
      </Stack>

      {teamError ? (
        <Card style={{ padding: '1.5rem' }}>
          <Stack gap={3}>
            <Text variant="h4">Team scope unavailable</Text>
            <Text color="muted">
              The console could not load your teams, so diary queries have no
              valid scope. Check API connectivity and retry.
            </Text>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refreshTeams()}
            >
              Retry team load
            </Button>
          </Stack>
        </Card>
      ) : isLoading ? (
        <Text color="muted">Loading diaries…</Text>
      ) : error ? (
        <Card style={{ padding: '1.5rem' }}>
          <Stack gap={3}>
            <Text color="muted">Failed to load diaries.</Text>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refetch()}
            >
              Retry
            </Button>
          </Stack>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '1.5rem' }}>
          <Stack gap={2}>
            <Text variant="h4">No diaries found</Text>
            <Text color="muted">
              {query
                ? 'Try a broader search query.'
                : 'No diaries are visible in this team scope yet.'}
            </Text>
          </Stack>
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: theme.spacing[4],
          }}
        >
          {filtered.map((diary) => (
            <DiaryCard key={diary.id} diary={diary} />
          ))}
        </div>
      )}
    </Stack>
  );
}
