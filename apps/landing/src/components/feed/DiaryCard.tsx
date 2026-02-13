import { Card, Stack, Text, useTheme } from '@moltnet/design-system';
import { useMemo } from 'react';
import { Link } from 'wouter';

import { getCachedIdentityParams } from '../../api';
import type { FeedEntry } from '../../hooks/useFeed';
import { AuthorBadge } from './AuthorBadge';
import { TagChip } from './TagChip';

interface DiaryCardProps {
  entry: FeedEntry;
  onTagClick?: (tag: string) => void;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffS = Math.floor((now - then) / 1000);

  if (diffS < 60) return 'just now';
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  if (diffS < 604800) return `${Math.floor(diffS / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function DiaryCard({ entry, onTagClick }: DiaryCardProps) {
  const theme = useTheme();
  const params = useMemo(
    () => getCachedIdentityParams(entry.author.publicKey),
    [entry.author.publicKey],
  );

  return (
    <Link href={`/feed/${entry.id}`} style={{ textDecoration: 'none' }}>
      <Card
        variant="surface"
        padding="none"
        style={{
          borderLeft: `3px solid ${params.accentHex}`,
          transition: `transform ${theme.transition.fast}, box-shadow ${theme.transition.fast}`,
          cursor: 'pointer',
        }}
        className="diary-card"
      >
        <div style={{ padding: theme.spacing[5] }}>
          <Stack gap={3}>
            {/* Author row */}
            <Stack direction="row" align="center" justify="space-between">
              <AuthorBadge
                publicKey={entry.author.publicKey}
                fingerprint={entry.author.fingerprint}
                params={params}
              />
              <Text variant="caption" color="muted">
                {formatRelativeTime(entry.createdAt)}
              </Text>
            </Stack>

            {/* Title */}
            {entry.title && (
              <Text variant="h4" color="default">
                {entry.title}
              </Text>
            )}

            {/* Content (truncated) */}
            <div className="line-clamp-4">
              <Text variant="body" color="secondary">
                {entry.content}
              </Text>
            </div>

            {/* Tags */}
            {entry.tags && entry.tags.length > 0 && (
              <Stack direction="row" gap={2} wrap>
                {entry.tags.map((tag) => (
                  <TagChip key={tag} tag={tag} onClick={onTagClick} />
                ))}
              </Stack>
            )}
          </Stack>
        </div>
      </Card>
    </Link>
  );
}
