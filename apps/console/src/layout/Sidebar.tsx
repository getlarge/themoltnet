import {
  Button,
  Divider,
  Logo,
  SideNavigation,
  type SideNavigationGroup,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  KeyRound,
  LibraryBig,
  ListTodo,
  PenLine,
  Settings,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { useLocation } from 'wouter';

import { TeamSelector } from '../components/TeamSelector.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { getConfig } from '../config.js';

const ICON_SIZE = 18;

interface NavDefinition {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
}

const baseGroups: Array<{
  id: string;
  label?: string;
  items: NavDefinition[];
}> = [
  {
    id: 'overview',
    items: [
      {
        id: 'operations',
        label: 'Operations',
        path: '/',
        icon: <Activity size={ICON_SIZE} strokeWidth={1.8} />,
      },
    ],
  },
  {
    id: 'task-engine',
    label: 'Task Engine',
    items: [
      {
        id: 'task-board',
        label: 'Task board',
        path: '/tasks',
        icon: <ListTodo size={ICON_SIZE} strokeWidth={1.8} />,
      },
      {
        id: 'task-analytics',
        label: 'Analytics',
        path: '/tasks/analytics',
        icon: <BarChart3 size={ICON_SIZE} strokeWidth={1.8} />,
      },
    ],
  },
  {
    id: 'agent-runtime',
    label: 'Agent Runtime',
    items: [
      {
        id: 'runtime-profiles',
        label: 'Profiles',
        path: '/runtime/profiles',
        icon: <Bot size={ICON_SIZE} strokeWidth={1.8} />,
      },
      {
        id: 'runtime-policies',
        label: 'Tool policies',
        path: '/runtime/policies',
        icon: <ShieldCheck size={ICON_SIZE} strokeWidth={1.8} />,
      },
      {
        id: 'agent-keys',
        label: 'Agent keys',
        path: '/runtime/agent-keys',
        icon: <KeyRound size={ICON_SIZE} strokeWidth={1.8} />,
      },
    ],
  },
  {
    id: 'knowledge-factory',
    label: 'Knowledge Factory',
    items: [
      {
        id: 'diaries',
        label: 'Diaries',
        path: '/diaries',
        icon: <LibraryBig size={ICON_SIZE} strokeWidth={1.8} />,
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      {
        id: 'teams',
        label: 'Teams',
        path: '/teams',
        icon: <UsersRound size={ICON_SIZE} strokeWidth={1.8} />,
      },
      {
        id: 'signing',
        label: 'Signing',
        path: '/signing',
        icon: <PenLine size={ICON_SIZE} strokeWidth={1.8} />,
      },
    ],
  },
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
  const activePath = baseGroups
    .flatMap((group) => group.items)
    .filter((item) => isActive(location, item.path))
    .reduce<string | null>(
      (best, item) =>
        best === null || item.path.length > best.length ? item.path : best,
      null,
    );
  const groups: SideNavigationGroup[] = baseGroups.map((group) => ({
    id: group.id,
    label: group.label,
    items: group.items.map((item) => ({
      id: item.id,
      label: item.label,
      href: item.path,
      icon: item.icon,
      current: item.path === activePath,
    })),
  }));

  return (
    <aside
      id={id}
      aria-label="Console navigation"
      style={{
        background: theme.color.bg.void,
        borderRight: `1px solid ${theme.color.border.DEFAULT}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        padding: collapsed
          ? `${theme.spacing[4]} ${theme.spacing[2]}`
          : theme.spacing[4],
        width: collapsed
          ? theme.layout.sidebarCollapsed
          : theme.layout.sidebarExpanded,
      }}
    >
      <SideNavigation
        collapsed={collapsed}
        groups={groups}
        onNavigate={(item, event) => {
          event.preventDefault();
          navigate(item.href);
        }}
        header={
          <Stack gap={4}>
            <button
              type="button"
              aria-label="Go to operations overview"
              onClick={() => navigate('/')}
              style={{
                alignItems: 'center',
                background: 'transparent',
                border: 0,
                color: 'inherit',
                cursor: 'pointer',
                display: 'flex',
                font: 'inherit',
                gap: theme.spacing[2],
                justifyContent: collapsed ? 'center' : 'flex-start',
                minHeight: '2.75rem',
                padding: theme.spacing[2],
                width: '100%',
              }}
            >
              <Logo variant="mark" style={{ height: 28, width: 28 }} />
              {collapsed ? null : (
                <Stack gap={0} align="flex-start">
                  <Text weight="semibold">MoltNet</Text>
                  <Text variant="caption" color="muted">
                    Operator console
                  </Text>
                </Stack>
              )}
            </button>
            {collapsed ? null : <TeamSelector />}
            <Divider />
          </Stack>
        }
        footer={
          <Stack gap={2}>
            <Divider />
            {collapsed ? null : <ThemeToggle />}
            <SidebarAction
              collapsed={collapsed}
              icon={<BookOpen size={ICON_SIZE} strokeWidth={1.8} />}
              label="Documentation"
              onClick={() =>
                window.open(
                  getConfig().docsUrl,
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            />
            <SidebarAction
              collapsed={collapsed}
              icon={<Settings size={ICON_SIZE} strokeWidth={1.8} />}
              label="Settings"
              onClick={() =>
                window.location.assign(`${getConfig().kratosUrl}/ui/settings`)
              }
            />
          </Stack>
        }
      />
    </aside>
  );
}

function SidebarAction({
  collapsed,
  icon,
  label,
  onClick,
}: {
  collapsed: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      style={{
        gap: '0.75rem',
        justifyContent: collapsed ? 'center' : 'flex-start',
        width: '100%',
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>
        {icon}
      </span>
      {collapsed ? null : label}
    </Button>
  );
}
