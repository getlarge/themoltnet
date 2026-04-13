import { Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { Link } from 'wouter';

import {
  type EntryType,
  estimateTokenCount,
  formatRelativeTime,
} from '../../diaries/utils.js';
import { ImportanceIndicator } from './ImportanceIndicator.js';
import { TagChip } from './TagChip.js';
import { TypeBadge } from './TypeBadge.js';

interface EntryCardProps {
  diaryId: string;
  entry: {
    id: string;
    title: string | null;
    content: string;
    tags: Array<string> | null;
    importance: number;
    entryType: EntryType;
    createdAt: string;
  };
  view?: 'grid' | 'timeline';
  onTagClick?: (tag: string) => void;
}

export function EntryCard({
  diaryId,
  entry,
  view = 'grid',
  onTagClick,
}: EntryCardProps) {
  const theme = useTheme();

  return (
    <Link
      href={`/diaries/${diaryId}/entries/${entry.id}`}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <Card
        variant="surface"
        padding="md"
        style={{
          position: 'relative',
          height: '100%',
          borderLeft:
            view === 'timeline'
              ? `3px solid ${theme.color.accent.DEFAULT}`
              : undefined,
          cursor: 'pointer',
        }}
      >
        <Stack gap={3}>
          <Stack
            direction="row"
            align="center"
            justify="space-between"
            gap={3}
            wrap
          >
            <TypeBadge type={entry.entryType} />
            <Text variant="caption" color="muted">
              {formatRelativeTime(entry.createdAt)}
            </Text>
          </Stack>

          <Stack gap={2}>
            <Text variant="h4">{entry.title ?? 'Untitled entry'}</Text>
            <Text
              color="secondary"
              style={{
                whiteSpace: 'pre-wrap',
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {entry.content}
            </Text>
          </Stack>

          <Stack direction="row" gap={3} wrap align="center">
            <ImportanceIndicator value={entry.importance} compact />
            <Text variant="caption" color="muted">
              ~{estimateTokenCount(entry.content)} tokens
            </Text>
          </Stack>

          {entry.tags && entry.tags.length > 0 && (
            <Stack direction="row" gap={2} wrap>
              {entry.tags.slice(0, 4).map((tag) => (
                <TagChip key={tag} tag={tag} onClick={onTagClick} />
              ))}
              {entry.tags.length > 4 && (
                <Text variant="caption" color="muted">
                  +{entry.tags.length - 4}
                </Text>
              )}
            </Stack>
          )}
        </Stack>
      </Card>
    </Link>
  );
}
