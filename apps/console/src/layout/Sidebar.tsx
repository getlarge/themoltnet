/**
 * Sidebar — Dashboard navigation sidebar.
 *
 * Uses design system primitives. Shows active route highlight.
 */

import { Button, Divider, Logo, Stack, Text } from '@themoltnet/design-system';
import { useLocation } from 'wouter';

interface NavItem {
  label: string;
  path: string;
  disabled?: boolean;
}

const mainNav: NavItem[] = [{ label: 'Overview', path: '/' }];

const exploreNav: NavItem[] = [
  { label: 'Explore', path: '/explore', disabled: true },
  { label: 'Packs', path: '/packs', disabled: true },
  { label: 'Tools', path: '/tools', disabled: true },
  { label: 'Labs', path: '/labs', disabled: true },
];

const bottomNav: NavItem[] = [{ label: 'Settings', path: '/settings' }];

function NavButton({
  item,
  isActive,
  onClick,
}: {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={isActive ? 'primary' : 'ghost'}
      disabled={item.disabled}
      onClick={onClick}
      style={{
        justifyContent: 'flex-start',
        width: '100%',
        opacity: item.disabled ? 0.4 : 1,
      }}
    >
      {item.label}
      {item.disabled && (
        <Text variant="caption" color="muted" style={{ marginLeft: 'auto' }}>
          soon
        </Text>
      )}
    </Button>
  );
}

export function Sidebar() {
  const [location, navigate] = useLocation();

  return (
    <Stack
      gap={2}
      style={{
        width: 220,
        minHeight: '100vh',
        padding: '1rem 0.75rem',
        borderRight: '1px solid var(--color-border, #333)',
        flexShrink: 0,
      }}
    >
      <Stack gap={1} style={{ padding: '0.5rem' }}>
        <Logo variant="mark" style={{ width: 28, height: 28 }} />
        <Text variant="h4">MoltNet</Text>
      </Stack>

      <Divider />

      <Stack gap={1}>
        {mainNav.map((item) => (
          <NavButton
            key={item.path}
            item={item}
            isActive={location === item.path}
            onClick={() => navigate(item.path)}
          />
        ))}
      </Stack>

      <Divider />

      <Stack gap={1}>
        {exploreNav.map((item) => (
          <NavButton
            key={item.path}
            item={item}
            isActive={location === item.path}
            onClick={() => !item.disabled && navigate(item.path)}
          />
        ))}
      </Stack>

      <div style={{ flex: 1 }} />

      <Divider />

      <Stack gap={1}>
        {bottomNav.map((item) => (
          <NavButton
            key={item.path}
            item={item}
            isActive={location === item.path}
            onClick={() => navigate(item.path)}
          />
        ))}
      </Stack>
    </Stack>
  );
}
