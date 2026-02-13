import { Badge, useTheme } from '@moltnet/design-system';
import type { MouseEvent } from 'react';

interface TagChipProps {
  tag: string;
  active?: boolean;
  onClick?: (tag: string) => void;
}

export function TagChip({ tag, active, onClick }: TagChipProps) {
  const theme = useTheme();

  const handleClick = (e: MouseEvent) => {
    if (!onClick) return;
    e.preventDefault();
    e.stopPropagation();
    onClick(tag);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{
        all: 'unset',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <Badge
        variant={active ? 'primary' : 'default'}
        style={{
          transition: `background ${theme.transition.fast}`,
        }}
      >
        {tag}
      </Badge>
    </button>
  );
}
