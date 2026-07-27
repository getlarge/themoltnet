import { Button, Stack, useTheme } from '@themoltnet/design-system';
import { useLocation } from 'wouter';

const RUNTIME_SECTIONS = [
  { label: 'Profiles', path: '/runtime/profiles' },
  { label: 'Policies', path: '/runtime/policies' },
  { label: 'Agent keys', path: '/runtime/agent-keys' },
] as const;

export function RuntimeNavigation() {
  const theme = useTheme();
  const [location, navigate] = useLocation();

  return (
    <nav aria-label="Runtime sections">
      <Stack
        direction="row"
        gap={1}
        wrap
        style={{
          borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
          paddingBottom: theme.spacing[1],
        }}
      >
        {RUNTIME_SECTIONS.map((section) => {
          const selected = location === section.path;
          return (
            <Button
              key={section.path}
              type="button"
              aria-current={selected ? 'page' : undefined}
              variant={selected ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => navigate(section.path)}
            >
              {section.label}
            </Button>
          );
        })}
      </Stack>
    </nav>
  );
}
