import { TagCloud } from '@moltnet/diary-ui';
import { Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { Link, useLocation } from 'wouter';

import { useDiaryDetails, useDiaryTags } from '../diaries/hooks.js';

export function DiaryExplorePage({ id }: { id: string }) {
  const theme = useTheme();
  const [, navigate] = useLocation();
  const diaryQuery = useDiaryDetails(id);
  const tagsQuery = useDiaryTags(id);
  const tags = tagsQuery.data ?? [];
  const diaryName = diaryQuery.data?.name ?? 'Diary';

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Link
          href={`/diaries/${id}`}
          style={{ color: theme.color.text.muted, textDecoration: 'none' }}
        >
          &larr; {diaryName}
        </Link>
        <Text variant="h2">Explore tags</Text>
        <Text color="muted">
          {tags.length} tag{tags.length === 1 ? '' : 's'} · click any tag to
          filter the diary by it.
        </Text>
      </Stack>

      {tagsQuery.isLoading ? (
        <Text color="muted">Loading tags…</Text>
      ) : tagsQuery.isError ? (
        <Card style={{ padding: '1.5rem' }}>
          <Text color="muted">Failed to load tags.</Text>
        </Card>
      ) : tags.length === 0 ? (
        <Card style={{ padding: '1.5rem' }}>
          <Stack gap={2}>
            <Text variant="h4">No tags yet</Text>
            <Text color="muted">
              Tags appear here once entries in this diary are tagged.
            </Text>
          </Stack>
        </Card>
      ) : (
        <Card variant="surface" padding="md">
          <TagCloud
            items={tags}
            onTagClick={(tag) => {
              if (!tag) return;
              navigate(`/diaries/${id}?tags=${encodeURIComponent(tag)}`);
            }}
          />
        </Card>
      )}
    </Stack>
  );
}
