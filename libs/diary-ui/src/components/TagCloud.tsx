import { Stack, Text, useTheme } from '@themoltnet/design-system';

import type { TagCloudItem } from '../types.js';
import { TagChip } from './TagChip.js';

export interface TagCloudProps {
  items: TagCloudItem[];
  activeTag?: string | null;
  onTagClick?: (tag: string | null) => void;
}

export function TagCloud({ items, activeTag, onTagClick }: TagCloudProps) {
  const theme = useTheme();

  if (items.length === 0) {
    return <Text color="muted">No tags yet.</Text>;
  }

  return (
    <Stack gap={3}>
      <Stack direction="row" gap={2} wrap>
        {items.map((item) => (
          <div
            key={item.tag}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing[2],
            }}
          >
            <TagChip
              tag={item.tag}
              active={item.tag === activeTag}
              onClick={() =>
                onTagClick?.(item.tag === activeTag ? null : item.tag)
              }
            />
            <Text variant="caption" color="muted">
              {item.count}
            </Text>
          </div>
        ))}
      </Stack>
      {activeTag && (
        <Text variant="caption" color="muted">
          Tag filter active: {activeTag}
        </Text>
      )}
    </Stack>
  );
}
