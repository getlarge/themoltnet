import { FetchError, ResponseError } from '@ory/client-fetch';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../src/auth/AuthProvider.js';
import { useAuth } from '../src/auth/useAuth.js';

// Mock the kratos client
const mockToSession = vi.fn();
const mockCreateBrowserLogoutFlow = vi.fn();
const mockUpdateLogoutFlow = vi.fn();

vi.mock('../src/kratos.js', () => ({
  getKratosClient: () => ({
    toSession: mockToSession,
    createBrowserLogoutFlow: mockCreateBrowserLogoutFlow,
    updateLogoutFlow: mockUpdateLogoutFlow,
  }),
}));

/** Builds the error @ory/client-fetch throws for a non-2xx response. */
function responseError(status: number): ResponseError {
  return new ResponseError(
    new Response(null, { status }),
    'Response returned an error code',
  );
}

const ACTIVE_SESSION = {
  active: true,
  identity: {
    id: 'identity-123',
    traits: { username: 'testuser', email: 'test@example.com' },
  },
};

function TestConsumer() {
  const { isAuthenticated, isLoading, username, email, error } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="username">{username ?? 'null'}</span>
      <span data-testid="email">{email ?? 'null'}</span>
      <span data-testid="error">{error?.message ?? 'null'}</span>
    </div>
  );
}

/** Renders, waits for the initial session check to settle. */
async function renderSettled(children = <TestConsumer />) {
  const result = render(<AuthProvider>{children}</AuthProvider>);
  await waitFor(() => {
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });
  return result;
}

/** Triggers focus-based revalidation and waits for the extra call to land. */
async function revalidateOnFocus() {
  const before = mockToSession.mock.calls.length;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => {
    expect(mockToSession.mock.calls.length).toBeGreaterThan(before);
  });
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockToSession.mockReturnValue(new Promise(() => {})); // Never resolves

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    expect(screen.getByTestId('loading').textContent).toBe('true');
  });

  it('sets authenticated state on successful session', async () => {
    mockToSession.mockResolvedValue(ACTIVE_SESSION);

    await renderSettled();

    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(screen.getByTestId('username').textContent).toBe('testuser');
    expect(screen.getByTestId('email').textContent).toBe('test@example.com');
  });

  it('clears session on 401', async () => {
    mockToSession.mockRejectedValue(responseError(401));

    await renderSettled();

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(screen.getByTestId('username').textContent).toBe('null');
  });

  it('clears session on 403 (aal2 required)', async () => {
    mockToSession.mockResolvedValueOnce(ACTIVE_SESSION);
    await renderSettled();
    expect(screen.getByTestId('authenticated').textContent).toBe('true');

    mockToSession.mockRejectedValueOnce(responseError(403));
    await revalidateOnFocus();

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').textContent).toBe('false');
    });
  });

  // Regression: issue #1747. A transient failure used to clear the session,
  // which bounced the user to login and back to the console root.
  it('preserves the session when a background check fails transiently', async () => {
    mockToSession.mockResolvedValueOnce(ACTIVE_SESSION);
    await renderSettled();

    mockToSession.mockRejectedValueOnce(
      new FetchError(new Error('network down'), 'The request failed'),
    );
    await revalidateOnFocus();

    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(screen.getByTestId('username').textContent).toBe('testuser');
  });

  it('preserves the session when the session check returns 500', async () => {
    mockToSession.mockResolvedValueOnce(ACTIVE_SESSION);
    await renderSettled();

    mockToSession.mockRejectedValueOnce(responseError(500));
    await revalidateOnFocus();

    expect(screen.getByTestId('authenticated').textContent).toBe('true');
  });

  it('surfaces a transient error while keeping the user authenticated', async () => {
    mockToSession.mockResolvedValueOnce(ACTIVE_SESSION);
    await renderSettled();

    mockToSession.mockRejectedValueOnce(responseError(503));
    await revalidateOnFocus();

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).not.toBe('null');
    });
    expect(screen.getByTestId('authenticated').textContent).toBe('true');
  });

  it('does not remount children during background revalidation', async () => {
    const onMount = vi.fn();

    function MountCounter() {
      useEffect(() => {
        onMount();
      }, []);
      return <TestConsumer />;
    }

    mockToSession.mockResolvedValue(ACTIVE_SESSION);
    await renderSettled(<MountCounter />);
    expect(onMount).toHaveBeenCalledTimes(1);

    await revalidateOnFocus();

    // isLoading must never flip back to true, otherwise AuthGuard swaps the
    // whole router subtree for the loading screen and page state is lost.
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('revalidates when the tab becomes visible', async () => {
    mockToSession.mockResolvedValue(ACTIVE_SESSION);
    await renderSettled();
    const callsAfterMount = mockToSession.mock.calls.length;

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(mockToSession.mock.calls.length).toBeGreaterThan(callsAfterMount);
    });
  });
});
