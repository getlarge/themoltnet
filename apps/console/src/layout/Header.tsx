import { Button, Stack, Text, useTheme } from '@themoltnet/design-system';

import { useAuth } from '../auth/useAuth.js';

export interface HeaderProps {
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

export function Header({ onMenuClick, showMenuButton = false }: HeaderProps) {
  const theme = useTheme();
  const { username, email, logout } = useAuth();

  return (
    <Stack
      direction="row"
      align="center"
      gap={4}
      style={{
        padding: `${theme.spacing[3]} ${theme.spacing[6]}`,
        borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
        justifyContent: 'space-between',
      }}
    >
      <div>
        {showMenuButton && onMenuClick && (
          <Button variant="ghost" size="sm" onClick={onMenuClick}>
            ☰
          </Button>
        )}
      </div>
      <Stack direction="row" align="center" gap={4}>
        <Text color="muted">{username ?? email ?? 'User'}</Text>
        <Button variant="ghost" onClick={logout}>
          Logout
        </Button>
      </Stack>
    </Stack>
  );
}
