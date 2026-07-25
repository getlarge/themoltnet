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
  /**
   * Optional tag-pivot. When provided, tags render as independent buttons that
   * sit *beside* (not inside) the card's open action, so there is no nested
   * interactive. Callers that don't want tag pivoting omit this and tags render
   * as plain, non-interactive chips.
   */
  onTagClick?: (tag: string) => void;
}

export function EntryCard({
  entry,
  view = 'grid',
  onOpen,
  onTagClick,
}: EntryCardProps) {
  // `view` is retained for callers; grid/timeline differ by their container
  // layout, not by a decorative accent border on the card itself.
  void view;

  return (
    <Card
      variant="surface"
      padding="md"
      style={{ position: 'relative', height: '100%' }}
    >
      {/* Primary action: a full-card overlay button. It is a *sibling* of the
          tag buttons below, never their parent — so the whole card opens the
          entry while tags remain independently focusable/clickable, with no
          invalid nested-interactive. */}
      <button
        type="button"
        onClick={() => onOpen(entry.id)}
        aria-label={entry.title ? `Open entry: ${entry.title}` : 'Open entry'}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          width: '100%',
          height: '100%',
          margin: 0,
          padding: 0,
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          borderRadius: 'inherit',
        }}
      />
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
            // Raise tags above the overlay action so they receive their own
            // clicks; the rest of the card falls through to "open entry".
            style={{
              minWidth: 0,
              overflow: 'hidden',
              position: 'relative',
              zIndex: 2,
            }}
          >
            {entry.tags.slice(0, 6).map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                onClick={
                  onTagClick ? (clicked) => onTagClick(clicked) : undefined
                }
              />
            ))}
          </Stack>
        )}
        <ImportanceIndicator value={entry.importance} />
      </Stack>
    </Card>
  );
}
