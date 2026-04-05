/**
 * Header — Dashboard top bar with username and logout.
 */

import { Button, Stack, Text } from '@themoltnet/design-system';

import { useAuth } from '../auth/useAuth.js';

export function Header() {
  const { username, email, logout } = useAuth();

  return (
    <Stack
      direction="row"
      align="center"
      justify="end"
      gap={4}
      style={{
        padding: '0.75rem 1.5rem',
        borderBottom: '1px solid var(--color-border, #333)',
      }}
    >
      <Text color="muted">{username ?? email ?? 'User'}</Text>
      <Button variant="ghost" onClick={logout}>
        Logout
      </Button>
    </Stack>
  );
}
