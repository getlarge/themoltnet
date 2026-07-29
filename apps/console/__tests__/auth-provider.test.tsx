import { FetchError, ResponseError } from '@ory/client-fetch';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function RefreshConsumer() {
  const { refreshSession } = useAuth();
  return (
    <button
      type="button"
      onClick={() => {
        void refreshSession();
        void refreshSession();
      }}
    >
      Refresh twice
    </button>
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

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it('coalesces foreground signals and throttles repeated attempts', async () => {
    let now = 100_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mockToSession.mockResolvedValue(ACTIVE_SESSION);
    await renderSettled();
    const callsAfterMount = mockToSession.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(mockToSession).toHaveBeenCalledTimes(callsAfterMount + 1);
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(mockToSession).toHaveBeenCalledTimes(callsAfterMount + 1);

    now += 30_000;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(mockToSession).toHaveBeenCalledTimes(callsAfterMount + 2);
    });
  });

  it('throttles foreground attempts after a transient failure', async () => {
    let now = 100_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mockToSession.mockResolvedValueOnce(ACTIVE_SESSION);
    await renderSettled();
    const callsAfterMount = mockToSession.mock.calls.length;

    mockToSession
      .mockRejectedValueOnce(responseError(503))
      .mockResolvedValue(ACTIVE_SESSION);
    await revalidateOnFocus();
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).not.toBe('null');
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockToSession).toHaveBeenCalledTimes(callsAfterMount + 1);

    now += 30_000;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(mockToSession).toHaveBeenCalledTimes(callsAfterMount + 2);
  });

  it('releases a hung session check after the timeout', async () => {
    mockToSession.mockResolvedValueOnce(ACTIVE_SESSION);
    await renderSettled(
      <>
        <TestConsumer />
        <RefreshConsumer />
      </>,
    );
    const callsAfterMount = mockToSession.mock.calls.length;
    vi.useFakeTimers();

    mockToSession
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue(ACTIVE_SESSION);
    window.dispatchEvent(new Event('focus'));
    expect(mockToSession).toHaveBeenCalledTimes(callsAfterMount + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId('error').textContent).toBe(
      'Session check timed out',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Refresh twice' }));
    expect(mockToSession).toHaveBeenCalledTimes(callsAfterMount + 2);
  });

  it('lets explicit refresh bypass the throttle and joins duplicate calls', async () => {
    mockToSession.mockResolvedValue(ACTIVE_SESSION);
    await renderSettled(
      <>
        <TestConsumer />
        <RefreshConsumer />
      </>,
    );

    await revalidateOnFocus();
    const callsAfterForegroundCheck = mockToSession.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Refresh twice' }));

    await waitFor(() => {
      expect(mockToSession).toHaveBeenCalledTimes(
        callsAfterForegroundCheck + 1,
      );
    });
  });
});
