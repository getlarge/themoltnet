import { Card, Stack, Text } from '@themoltnet/design-system';

import type { EntryType } from '../types.js';
import { formatRelativeTime } from '../utils/format.js';
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
}

export function EntryCard({ entry, view = 'grid', onOpen }: EntryCardProps) {
  // `view` is retained for callers; grid/timeline differ by their container
  // layout, not by a decorative accent border on the card itself.
  void view;

  return (
    <button
      type="button"
      onClick={() => onOpen(entry.id)}
      style={{
        display: 'block',
        width: '100%',
        padding: 0,
        margin: 0,
        border: 0,
        background: 'transparent',
        textAlign: 'left',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
      }}
    >
      <Card
        variant="surface"
        padding="md"
        style={{ position: 'relative', height: '100%' }}
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
            <Stack
              direction="row"
              gap={2}
              wrap
              style={{ minWidth: 0, overflow: 'hidden' }}
            >
              {/* Non-interactive inside the card button: nesting a
                  role="button" TagChip in the card's <button> is invalid for
                  AT. Tag filtering lives in the FilterBar. */}
              {entry.tags.slice(0, 6).map((tag) => (
                <TagChip key={tag} tag={tag} />
              ))}
            </Stack>
          )}
          <ImportanceIndicator value={entry.importance} />
        </Stack>
      </Card>
    </button>
  );
}
