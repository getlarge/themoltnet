import { Badge, useTheme } from '@themoltnet/design-system';
import type { KeyboardEvent, MouseEvent } from 'react';

export function TagChip({
  tag,
  active = false,
  onClick,
}: {
  tag: string;
  active?: boolean;
  onClick?: (tag: string) => void;
}) {
  const theme = useTheme();

  function handleClick(event: MouseEvent | KeyboardEvent) {
    if (!onClick) return;
    event.preventDefault();
    event.stopPropagation();
    onClick(tag);
  }

  return (
    <span
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === 'Enter' || event.key === ' ') {
          handleClick(event);
        }
      }}
      style={{
        display: 'inline-flex',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <Badge
        variant={active ? 'primary' : 'default'}
        style={{ transition: `background ${theme.transition.fast}` }}
      >
        {tag}
      </Badge>
    </span>
  );
}
