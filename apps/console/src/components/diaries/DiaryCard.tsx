import { Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { Link } from 'wouter';

import type { DiarySummary } from '../../diaries/utils.js';
import { formatRelativeTime } from '../../diaries/utils.js';

export function DiaryCard({ diary }: { diary: DiarySummary }) {
  const theme = useTheme();

  return (
    <Link
      href={`/diaries/${diary.id}`}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <Card
        variant="surface"
        padding="md"
        style={{
          height: '100%',
          transition: `transform ${theme.transition.fast}, box-shadow ${theme.transition.fast}`,
          cursor: 'pointer',
        }}
      >
        <Stack gap={3}>
          <Stack gap={1}>
            <Text variant="h4">{diary.name}</Text>
            <Text variant="caption" color="muted" mono>
              {diary.id}
            </Text>
          </Stack>

          <Stack direction="row" gap={2} wrap>
            <Text variant="caption" color="muted">
              {diary.entryCount} entries
            </Text>
            <Text variant="caption" color="muted">
              {diary.tagCount} tags
            </Text>
            <Text variant="caption" color="muted">
              {diary.visibility}
            </Text>
          </Stack>

          <Text color="muted">
            Last entry: {formatRelativeTime(diary.latestEntryAt)}
          </Text>
        </Stack>
      </Card>
    </Link>
  );
}
