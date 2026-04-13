import { Stack, Text, useTheme } from '@themoltnet/design-system';

import { TagChip } from './TagChip.js';

export interface TagCloudItem {
  tag: string;
  count: number;
}

export function TagCloud({
  items,
  activeTag,
  onTagClick,
}: {
  items: Array<TagCloudItem>;
  activeTag?: string | null;
  onTagClick?: (tag: string | null) => void;
}) {
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
