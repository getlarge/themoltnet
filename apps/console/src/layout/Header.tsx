import { Button, Stack, Text, useTheme } from '@themoltnet/design-system';
import { LogOut, PanelLeft } from 'lucide-react';

import { useAuth } from '../auth/useAuth.js';

export interface HeaderProps {
  menuControls?: string;
  menuExpanded?: boolean;
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

export function Header({
  menuControls,
  menuExpanded,
  onMenuClick,
  showMenuButton = false,
}: HeaderProps) {
  const theme = useTheme();
  const { username, email, logout } = useAuth();

  return (
    <header
      style={{
        alignItems: 'center',
        background: theme.color.bg.void,
        borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
        display: 'flex',
        flex: '0 0 auto',
        gap: theme.spacing[4],
        height: theme.layout.topbarHeight,
        justifyContent: 'space-between',
        padding: `0 ${theme.spacing[5]}`,
      }}
    >
      <div>
        {showMenuButton && onMenuClick ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onMenuClick}
            aria-label={menuExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-controls={menuControls}
            aria-expanded={menuExpanded}
            title={menuExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            style={{ paddingInline: theme.spacing[3] }}
          >
            <PanelLeft aria-hidden="true" size={18} strokeWidth={1.8} />
          </Button>
        ) : null}
      </div>
      <Stack direction="row" align="center" gap={3}>
        <Text variant="caption" color="muted">
          {username ?? email ?? 'Operator'}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          aria-label="Log out"
          title="Log out"
          style={{ paddingInline: theme.spacing[3] }}
        >
          <LogOut aria-hidden="true" size={17} strokeWidth={1.8} />
        </Button>
      </Stack>
    </header>
  );
}
