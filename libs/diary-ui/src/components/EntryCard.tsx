import { Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import type { KeyboardEventHandler } from 'react';

import type { EntryType } from '../types.js';
import { formatRelativeTime } from './format.js';
import { ImportanceIndicator } from './ImportanceIndicator.js';
import { TagChip } from './TagChip.js';
import { TypeBadge } from './TypeBadge.js';

export interface EntryCardEntry {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
  importance: number;
  entryType: EntryType;
  createdAt: string;
}

export interface EntryCardProps {
  entry: EntryCardEntry;
  view?: 'grid' | 'timeline';
  onOpen: (entryId: string) => void;
  onTagClick?: (tag: string) => void;
}

export function EntryCard({
  entry,
  view = 'grid',
  onOpen,
  onTagClick,
}: EntryCardProps) {
  const theme = useTheme();
  const handleClick = () => onOpen(entry.id);
  const handleKey: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(entry.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKey}
      style={{ cursor: 'pointer' }}
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
          {entry.title && <Text variant="h4">{entry.title}</Text>}
          <Text color="muted" style={{ overflow: 'hidden', maxHeight: '6em' }}>
            {entry.content}
          </Text>
          {entry.tags && entry.tags.length > 0 && (
            <Stack direction="row" gap={2} wrap>
              {entry.tags.slice(0, 6).map((tag) => (
                <TagChip
                  key={tag}
                  tag={tag}
                  onClick={
                    onTagClick
                      ? (clickedTag) => onTagClick(clickedTag)
                      : undefined
                  }
                />
              ))}
            </Stack>
          )}
          <ImportanceIndicator value={entry.importance} />
        </Stack>
      </Card>
    </div>
  );
}
