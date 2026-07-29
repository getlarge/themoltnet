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

/**
 * Builds the absolute URL to return to after login, preserving the path, query
 * and hash the user was actually trying to reach.
 *
 * Kratos matches `allowed_return_urls` by scheme + host + path *prefix* (see
 * ory/kratos x/redir/secure_redirect.go), so the existing console origin entry
 * already covers every subpath — no Ory config change is required.
 *
 * `consoleUrl` carries no trailing slash, so this uses the URL constructor
 * rather than string concatenation to avoid producing "//tasks".
 */
function buildReturnTo(consoleUrl: string): string {
  const { pathname, search, hash } = window.location;
  return new URL(`${pathname}${search}${hash}`, consoleUrl).toString();
}

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
    const { kratosUrl, consoleUrl } = getConfig();
    const loginUrl = new URL('/self-service/login/browser', kratosUrl);
    loginUrl.searchParams.set('return_to', buildReturnTo(consoleUrl));
    window.location.assign(loginUrl.toString());
    return null;
  }

  return <>{children}</>;
}
