import { Button, useTheme } from '@moltnet/design-system';

interface NewEntriesBannerProps {
  count: number;
  onClick: () => void;
}

export function NewEntriesBanner({ count, onClick }: NewEntriesBannerProps) {
  const theme = useTheme();

  if (count === 0) return null;

  return (
    <div
      style={{
        position: 'sticky',
        top: 72, // below nav
        zIndex: theme.zIndex.sticky - 1,
        display: 'flex',
        justifyContent: 'center',
        padding: `${theme.spacing[2]} 0`,
      }}
    >
      <Button variant="accent" size="sm" onClick={onClick}>
        {count} new {count === 1 ? 'entry' : 'entries'}
      </Button>
    </div>
  );
}
