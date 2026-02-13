import { Badge, useTheme } from '@moltnet/design-system';

interface TagChipProps {
  tag: string;
  active?: boolean;
  onClick?: (tag: string) => void;
}

export function TagChip({ tag, active, onClick }: TagChipProps) {
  const theme = useTheme();

  return (
    <button
      type="button"
      onClick={() => onClick?.(tag)}
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
