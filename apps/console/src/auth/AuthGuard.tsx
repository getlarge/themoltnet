/**
 * AuthGuard — Protects routes that require authentication.
 *
 * Shows a loading state while checking session, redirects to login
 * if not authenticated, and renders children if authenticated.
 */

import { Stack, Text } from '@themoltnet/design-system';
import type { ReactNode } from 'react';

import { getConfig } from '../config.js';
import { useAuth } from './useAuth.js';

export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Stack align="center" justify="center" style={{ minHeight: '100vh' }}>
        <Text color="muted">Loading...</Text>
      </Stack>
    );
  }

  if (!isAuthenticated) {
    const returnTo = encodeURIComponent(`${getConfig().consoleUrl}/`);
    window.location.assign(
      `${getConfig().kratosUrl}/self-service/login/browser?return_to=${returnTo}`,
    );
    return null;
  }

  return <>{children}</>;
}
