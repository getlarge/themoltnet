import {
  Button,
  Divider,
  Logo,
  Stack,
  useTheme,
} from '@themoltnet/design-system';
import { useLocation } from 'wouter';

import { TeamSelector } from '../components/TeamSelector.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { getConfig } from '../config.js';

interface NavItem {
  label: string;
  path: string;
}

const navItems: NavItem[] = [
  { label: 'Overview', path: '/' },
  { label: 'Diaries', path: '/diaries' },
  { label: 'Tasks', path: '/tasks' },
  { label: 'Profiles', path: '/profiles' },
  { label: 'Teams', path: '/teams' },
];

function isActive(location: string, path: string): boolean {
  if (path === '/') return location === '/';
  return location === path || location.startsWith(`${path}/`);
}

export interface SidebarProps {
  collapsed?: boolean;
  id?: string;
}

export function Sidebar({ collapsed = false, id }: SidebarProps) {
  const theme = useTheme();
  const [location, navigate] = useLocation();

  const width = collapsed ? 56 : 220;

  return (
    <aside
      id={id}
      aria-label="Console navigation"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing[2],
        width,
        minHeight: '100vh',
        padding: collapsed ? '1rem 0.25rem' : '1rem 0.75rem',
        borderRight: `1px solid ${theme.color.border.DEFAULT}`,
        background: theme.color.bg.void,
        flexShrink: 0,
        transition: `width ${theme.transition.fast}`,
        overflow: 'hidden',
      }}
    >
      {/* Logo */}
      <button
        type="button"
        aria-label="Go to overview"
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing[1],
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: '0.5rem',
          cursor: 'pointer',
          width: '100%',
          background: 'transparent',
          border: 0,
          color: 'inherit',
          font: 'inherit',
        }}
        onClick={() => navigate('/')}
      >
        <Logo variant="mark" style={{ width: 28, height: 28 }} />
        {!collapsed && (
          <span
            style={{
              fontFamily: theme.font.family.sans,
              fontWeight: theme.font.weight.semibold,
              fontSize: theme.font.size.lg,
              color: theme.color.text.DEFAULT,
            }}
          >
            MoltNet
          </span>
        )}
      </button>

      {/* Team selector */}
      {!collapsed && <TeamSelector />}

      <Divider />

      {/* Nav items */}
      <nav aria-label="Primary">
        <Stack gap={1}>
          {navItems.map((item) => {
            const active = isActive(location, item.path);

            return (
              <Button
                key={item.path}
                variant={active ? 'primary' : 'ghost'}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? item.label : undefined}
                onClick={() => navigate(item.path)}
                style={{
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  width: '100%',
                }}
              >
                {collapsed ? item.label.charAt(0) : item.label}
              </Button>
            );
          })}
        </Stack>
      </nav>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      <Divider />

      {/* Bottom section */}
      <Stack gap={1}>
        {!collapsed && <ThemeToggle />}
        <Button
          variant="ghost"
          onClick={() =>
            window.open(getConfig().docsUrl, '_blank', 'noopener,noreferrer')
          }
          aria-label={collapsed ? 'Documentation' : undefined}
          title="Documentation"
          style={{
            justifyContent: collapsed ? 'center' : 'flex-start',
            width: '100%',
          }}
        >
          {collapsed ? 'D' : 'Docs'}
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            window.location.assign(`${getConfig().kratosUrl}/ui/settings`)
          }
          aria-label={collapsed ? 'Settings' : undefined}
          style={{
            justifyContent: collapsed ? 'center' : 'flex-start',
            width: '100%',
          }}
        >
          {collapsed ? 'S' : 'Settings'}
        </Button>
      </Stack>
    </aside>
  );
}
