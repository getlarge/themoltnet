import { Button, useThemeMode } from '@themoltnet/design-system';

type Mode = 'system' | 'dark' | 'light';

const modes: Mode[] = ['system', 'dark', 'light'];
const labels: Record<Mode, string> = {
  system: 'System',
  dark: 'Dark',
  light: 'Light',
};

export function ThemeToggle() {
  const { preferredMode, setMode } = useThemeMode();

  const next = modes[(modes.indexOf(preferredMode) + 1) % modes.length];

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        setMode(next);
        localStorage.setItem('moltnet-theme', next);
      }}
      style={{ width: '100%', justifyContent: 'flex-start' }}
    >
      Theme: {labels[preferredMode]}
    </Button>
  );
}
