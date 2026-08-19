import { ResponseError } from '@ory/client-fetch';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../src/auth/AuthGuard.js';
import { AuthProvider } from '../src/auth/AuthProvider.js';

const mockToSession = vi.fn();
const mockReplace = vi.fn();
const mockCreateBrowserLogoutFlow = vi.fn();

vi.mock('../src/kratos.js', () => ({
  getKratosClient: () => ({
    toSession: mockToSession,
    createBrowserLogoutFlow: mockCreateBrowserLogoutFlow,
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
function responseError(status: number, body?: unknown): ResponseError {
  const response =
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
  return new ResponseError(response, 'Response returned an error code');
}

/**
 * The 403 Kratos returns from /sessions/whoami when the cookie is valid but the
 * session sits below the required Authenticator Assurance Level.
 */
function aal2RequiredError(
  redirectBrowserTo = 'https://auth.example.com/self-service/login/browser?aal=aal2',
): ResponseError {
  return responseError(403, {
    error: { id: 'session_aal2_required', code: 403 },
    redirect_browser_to: redirectBrowserTo,
  });
}

/** Must match AuthGuard's sentinel parameter and storage key. */
const HOP_PARAM = '_authhop';
const HOP_STORAGE_KEY = 'moltnet.console.auth-hop';

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
    value: { replace: mockReplace, assign: vi.fn(), pathname, search, hash },
    writable: true,
  });
}

function renderGuard() {
  return render(
    <AuthGuard>
      <div data-testid="protected">Protected content</div>
    </AuthGuard>,
    { wrapper: Wrapper },
  );
}

/** Renders the guard unauthenticated and returns the URL it navigated to. */
async function captureSignInUrl(): Promise<URL> {
  renderGuard();
  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalled();
  });
  return new URL(mockReplace.mock.calls[0][0]);
}

/**
 * Renders the guard unauthenticated and returns return_to with the loop
 * sentinel taken back out, so destination assertions stay about the
 * destination. The sentinel itself is covered by its own describe block.
 */
async function captureReturnTo(): Promise<string | null> {
  mockToSession.mockRejectedValue(responseError(401));
  const raw = (await captureSignInUrl()).searchParams.get('return_to');
  if (raw === null) return null;
  const url = new URL(raw);
  url.searchParams.delete(HOP_PARAM);
  return url.toString();
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
    window.sessionStorage.clear();
    setLocation({ pathname: '/' });
  });

  it('shows loading state while checking session', () => {
    mockToSession.mockReturnValue(new Promise(() => {}));

    renderGuard();

    expect(screen.queryByTestId('protected')).toBeNull();
    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('does not redirect while the session check is in flight', async () => {
    mockToSession.mockReturnValue(new Promise(() => {}));

    renderGuard();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('redirects to Ory login when not authenticated', async () => {
    mockToSession.mockRejectedValue(responseError(401));

    renderGuard();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });

    expect(mockReplace.mock.calls[0][0]).toContain(
      'https://auth.example.com/self-service/login/browser',
    );
    expect(screen.queryByTestId('protected')).toBeNull();
  });

  it('redirects only once per page load', async () => {
    mockToSession.mockRejectedValue(responseError(401));

    const { rerender } = renderGuard();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    rerender(
      <Wrapper>
        <AuthGuard>
          <div data-testid="protected">Protected content</div>
        </AuthGuard>
      </Wrapper>,
    );

    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  // Regression: assign() pushed a history entry for every bounce
  // through Kratos, so Back walked backwards through the loop rather than out
  // of it — on mobile, with no way to clear cookies per domain, that left the
  // user with no escape at all.
  it('replaces the history entry instead of pushing one', async () => {
    mockToSession.mockRejectedValue(responseError(401));

    renderGuard();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });
    expect(window.location.assign).not.toHaveBeenCalled();
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

    renderGuard();

    await waitFor(() => {
      expect(screen.getByTestId('protected')).toBeDefined();
    });

    expect(screen.getByTestId('protected').textContent).toBe(
      'Protected content',
    );
  });

  // Regression: a session parked at aal1 (OIDC login abandoned at
  // the 2FA step) sent to a plain login flow makes Kratos answer "already
  // logged in" and 302 back to return_to — console -> Kratos -> console,
  // forever. The aal2 marker is what makes Kratos render the 2FA form instead.
  describe('when the session needs a second factor', () => {
    it('follows the redirect_browser_to Kratos supplies', async () => {
      mockToSession.mockRejectedValue(aal2RequiredError());

      const url = await captureSignInUrl();

      expect(url.origin + url.pathname).toBe(
        'https://auth.example.com/self-service/login/browser',
      );
      expect(url.searchParams.get('aal')).toBe('aal2');
      const returnTo = new URL(url.searchParams.get('return_to') as string);
      returnTo.searchParams.delete(HOP_PARAM);
      expect(returnTo.toString()).toBe('https://console.example.com/');
    });

    it('still requests aal2 when Kratos omits redirect_browser_to', async () => {
      mockToSession.mockRejectedValue(
        responseError(403, { error: { id: 'session_aal2_required' } }),
      );

      expect((await captureSignInUrl()).searchParams.get('aal')).toBe('aal2');
    });

    it('ignores a redirect_browser_to pointing at another origin', async () => {
      mockToSession.mockRejectedValue(
        aal2RequiredError(
          'https://evil.example.net/self-service/login/browser',
        ),
      );

      const url = await captureSignInUrl();

      expect(url.origin).toBe('https://auth.example.com');
      expect(url.searchParams.get('aal')).toBe('aal2');
    });

    it('does not add aal2 to a plain unauthenticated redirect', async () => {
      mockToSession.mockRejectedValue(responseError(401));

      expect((await captureSignInUrl()).searchParams.has('aal')).toBe(false);
    });
  });

  /**
   * The loop is broken by recognising our own round trip, not by counting.
   * `return_to` carries a nonce; if Kratos hands the browser back with that
   * nonce and the session is still unusable, the flow we picked cannot fix it,
   * so re-entering it is exactly the loop.
   *
   * The nonce lives in sessionStorage because the round trip is a full page
   * load. These tests seed it to stand in for the outbound leg.
   */
  describe('sign-in bounce detection', () => {
    /** Simulates having been redirected out with `hop`, then sent back. */
    function seedBounce(hop: string, returnedHop: string = hop) {
      window.sessionStorage.setItem(HOP_STORAGE_KEY, hop);
      setLocation({
        pathname: '/tasks',
        search: `?${HOP_PARAM}=${returnedHop}`,
      });
    }

    it('tags return_to with a sentinel and remembers it', async () => {
      mockToSession.mockRejectedValue(responseError(401));

      const returnTo = (await captureSignInUrl()).searchParams.get('return_to');

      const hop = new URL(returnTo as string).searchParams.get(HOP_PARAM);
      expect(hop).toBeTruthy();
      expect(window.sessionStorage.getItem(HOP_STORAGE_KEY)).toBe(hop);
    });

    it('keeps the real query string alongside the sentinel', async () => {
      setLocation({ pathname: '/diaries/abc', search: '?filter=open' });
      mockToSession.mockRejectedValue(responseError(401));

      const returnTo = new URL(
        (await captureSignInUrl()).searchParams.get('return_to') as string,
      );

      expect(returnTo.searchParams.get('filter')).toBe('open');
      expect(returnTo.searchParams.get(HOP_PARAM)).toBeTruthy();
    });

    // The bug: Kratos answered "already logged in" and 302'd straight back.
    // One proven bounce is enough to know the flow cannot clear the challenge.
    it('stops on the first bounce instead of redirecting again', async () => {
      mockToSession.mockRejectedValue(aal2RequiredError());
      seedBounce('hop-1');

      renderGuard();

      await waitFor(() => {
        expect(screen.getByTestId('auth-loop-recovery')).toBeDefined();
      });
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('redirects normally when no sentinel comes back', async () => {
      mockToSession.mockRejectedValue(aal2RequiredError());
      window.sessionStorage.setItem(HOP_STORAGE_KEY, 'hop-1');

      renderGuard();

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalled();
      });
      expect(screen.queryByTestId('auth-loop-recovery')).toBeNull();
    });

    // A sentinel from a bookmarked or shared URL is not evidence that *this*
    // tab just bounced, so it must not strand the visitor on the recovery page.
    it('ignores a sentinel that does not match the one we issued', async () => {
      mockToSession.mockRejectedValue(aal2RequiredError());
      seedBounce('hop-1', 'pasted-from-somewhere-else');

      renderGuard();

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalled();
      });
      expect(screen.queryByTestId('auth-loop-recovery')).toBeNull();
    });

    it('does not carry the sentinel into the next return_to', async () => {
      mockToSession.mockRejectedValue(aal2RequiredError());
      seedBounce('hop-1', 'stale');

      const returnTo = new URL(
        (await captureSignInUrl()).searchParams.get('return_to') as string,
      );

      expect(returnTo.pathname).toBe('/tasks');
      expect(returnTo.searchParams.get(HOP_PARAM)).not.toBe('stale');
    });

    // It is machinery: a user who bookmarks or shares the URL should not
    // carry it along, and it should not sit in history.
    it('strips the sentinel from the address bar', async () => {
      const replaceState = vi.spyOn(window.history, 'replaceState');
      mockToSession.mockRejectedValue(aal2RequiredError());
      seedBounce('hop-1');

      renderGuard();

      await waitFor(() => {
        expect(replaceState).toHaveBeenCalledWith(null, '', '/tasks');
      });
    });

    it('offers a sign-out escape hatch that clears the session server-side', async () => {
      mockToSession.mockRejectedValue(aal2RequiredError());
      mockCreateBrowserLogoutFlow.mockResolvedValue({
        logout_url: 'https://auth.example.com/self-service/logout?token=abc',
      });
      seedBounce('hop-1');

      renderGuard();

      await waitFor(() => {
        expect(screen.getByTestId('auth-loop-recovery')).toBeDefined();
      });
      fireEvent.click(screen.getByText('Sign out and start over'));

      await waitFor(() => {
        expect(mockCreateBrowserLogoutFlow).toHaveBeenCalled();
      });
    });

    it('lets the user retry verification with a fresh sentinel', async () => {
      mockToSession.mockRejectedValue(aal2RequiredError());
      seedBounce('hop-1');

      renderGuard();

      await waitFor(() => {
        expect(screen.getByTestId('auth-loop-recovery')).toBeDefined();
      });
      fireEvent.click(screen.getByText('Continue verification'));

      expect(mockReplace).toHaveBeenCalledTimes(1);
      const signInUrl = new URL(mockReplace.mock.calls[0][0]);
      expect(signInUrl.searchParams.get('aal')).toBe('aal2');
      // A new nonce, otherwise the retry would arrive carrying the sentinel
      // that just tripped the guard and land straight back on this screen.
      const hop = new URL(
        signInUrl.searchParams.get('return_to') as string,
      ).searchParams.get(HOP_PARAM);
      expect(hop).toBeTruthy();
      expect(hop).not.toBe('hop-1');
      expect(window.sessionStorage.getItem(HOP_STORAGE_KEY)).toBe(hop);
    });

    it('clears the sentinel once the user is authenticated', async () => {
      window.sessionStorage.setItem(HOP_STORAGE_KEY, 'hop-1');
      mockToSession.mockResolvedValue({
        active: true,
        identity: { id: 'identity-123', traits: {} },
      });

      renderGuard();

      await waitFor(() => {
        expect(screen.getByTestId('protected')).toBeDefined();
      });
      await waitFor(() => {
        expect(window.sessionStorage.getItem(HOP_STORAGE_KEY)).toBeNull();
      });
    });
  });
});
