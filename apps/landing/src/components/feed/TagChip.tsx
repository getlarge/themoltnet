import { Badge, useTheme } from '@themoltnet/design-system';
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

  const badge = (
    <Badge
      variant={active ? 'primary' : 'default'}
      style={{
        transition: `background ${theme.transition.fast}`,
      }}
    >
      {tag}
    </Badge>
  );

  if (!onClick) return badge;

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={handleClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
      }}
    >
      {badge}
    </button>
  );
}
