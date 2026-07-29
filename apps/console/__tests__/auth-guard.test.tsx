import { ResponseError } from '@ory/client-fetch';
import { render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../src/auth/AuthGuard.js';
import { AuthProvider } from '../src/auth/AuthProvider.js';

const mockToSession = vi.fn();
const mockAssign = vi.fn();

vi.mock('../src/kratos.js', () => ({
  getKratosClient: () => ({
    toSession: mockToSession,
    createBrowserLogoutFlow: vi.fn(),
  }),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    kratosUrl: 'https://auth.example.com',
    // Deliberately without a trailing slash, matching production config.
    consoleUrl: 'https://console.example.com',
    apiBaseUrl: 'https://api.example.com',
  }),
}));

/** Builds the error @ory/client-fetch throws for a non-2xx response. */
function responseError(status: number): ResponseError {
  return new ResponseError(
    new Response(null, { status }),
    'Response returned an error code',
  );
}

/** Points window.location at a console path before rendering. */
function setLocation({
  pathname = '/',
  search = '',
  hash = '',
}: {
  pathname?: string;
  search?: string;
  hash?: string;
}) {
  Object.defineProperty(window, 'location', {
    value: { assign: mockAssign, pathname, search, hash },
    writable: true,
  });
}

/** Renders the guard unauthenticated and returns the parsed return_to. */
async function captureReturnTo(): Promise<string | null> {
  mockToSession.mockRejectedValue(responseError(401));

  render(
    <AuthGuard>
      <div data-testid="protected">Protected content</div>
    </AuthGuard>,
    { wrapper: Wrapper },
  );

  await waitFor(() => {
    expect(mockAssign).toHaveBeenCalled();
  });

  return new URL(mockAssign.mock.calls[0][0]).searchParams.get('return_to');
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MoltThemeProvider mode="dark">
      <AuthProvider>{children}</AuthProvider>
    </MoltThemeProvider>
  );
}

describe('AuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLocation({ pathname: '/' });
  });

  it('shows loading state while checking session', () => {
    mockToSession.mockReturnValue(new Promise(() => {}));

    render(
      <AuthGuard>
        <div data-testid="protected">Protected content</div>
      </AuthGuard>,
      { wrapper: Wrapper },
    );

    expect(screen.queryByTestId('protected')).toBeNull();
    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('does not redirect while the session check is in flight', async () => {
    mockToSession.mockReturnValue(new Promise(() => {}));

    render(
      <AuthGuard>
        <div data-testid="protected">Protected content</div>
      </AuthGuard>,
      { wrapper: Wrapper },
    );

    expect(mockAssign).not.toHaveBeenCalled();
  });

  it('redirects to Ory login when not authenticated', async () => {
    mockToSession.mockRejectedValue(responseError(401));

    render(
      <AuthGuard>
        <div data-testid="protected">Protected content</div>
      </AuthGuard>,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalled();
    });

    expect(mockAssign.mock.calls[0][0]).toContain(
      'https://auth.example.com/self-service/login/browser',
    );
    expect(screen.queryByTestId('protected')).toBeNull();
  });

  // Regression: issue #1747. return_to was hardcoded to the console root, so
  // any bounce through Kratos dropped the user back at "/".
  it('preserves the requested deep path in return_to', async () => {
    setLocation({ pathname: '/tasks/123' });

    expect(await captureReturnTo()).toBe(
      'https://console.example.com/tasks/123',
    );
  });

  it('preserves query string and hash in return_to', async () => {
    setLocation({
      pathname: '/diaries/abc',
      search: '?filter=open',
      hash: '#section',
    });

    expect(await captureReturnTo()).toBe(
      'https://console.example.com/diaries/abc?filter=open#section',
    );
  });

  it('does not produce a double slash when consoleUrl lacks a trailing slash', async () => {
    setLocation({ pathname: '/tasks' });

    const returnTo = await captureReturnTo();

    expect(returnTo).toBe('https://console.example.com/tasks');
    expect(returnTo?.replace('https://', '')).not.toContain('//');
  });

  it('still returns to the root when the user was on the root', async () => {
    setLocation({ pathname: '/' });

    expect(await captureReturnTo()).toBe('https://console.example.com/');
  });

  it('renders children when authenticated', async () => {
    mockToSession.mockResolvedValue({
      active: true,
      identity: {
        id: 'identity-123',
        traits: { username: 'testuser', email: 'test@example.com' },
      },
    });

    render(
      <AuthGuard>
        <div data-testid="protected">Protected content</div>
      </AuthGuard>,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(screen.getByTestId('protected')).toBeDefined();
    });

    expect(screen.getByTestId('protected').textContent).toBe(
      'Protected content',
    );
  });
});
