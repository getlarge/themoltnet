import { ResponseError } from '@ory/client-fetch';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthPage } from '../src/auth/AuthPage.js';

const mockCreateSettingsFlow = vi.fn();
const mockGetSettingsFlow = vi.fn();
const mockCreateLoginFlow = vi.fn();
const mockGetLoginFlow = vi.fn();
const mockCreateRegistrationFlow = vi.fn();
const mockCreateRecoveryFlow = vi.fn();
const mockGetFlowError = vi.fn();
const mockAssign = vi.fn();

vi.mock('../src/kratos.js', () => ({
  getKratosClient: () => ({
    createBrowserSettingsFlow: mockCreateSettingsFlow,
    getSettingsFlow: mockGetSettingsFlow,
    createBrowserLoginFlow: mockCreateLoginFlow,
    getLoginFlow: mockGetLoginFlow,
    createBrowserRegistrationFlow: mockCreateRegistrationFlow,
    createBrowserRecoveryFlow: mockCreateRecoveryFlow,
    getFlowError: mockGetFlowError,
  }),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    kratosUrl: 'https://auth.example.test',
    consoleUrl: 'https://console.example.test',
    apiBaseUrl: 'https://api.example.test',
  }),
}));

vi.mock('../src/auth/useAuth.js', () => ({
  useAuth: () => ({ session: null, refreshSession: vi.fn(), logout: vi.fn() }),
}));

function responseError(status: number, body: unknown): ResponseError {
  return new ResponseError(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function renderPage(
  page:
    'settings' | 'login' | 'registration' | 'recovery' | 'error' = 'settings',
) {
  return render(
    <MoltThemeProvider mode="dark">
      <AuthPage page={page} />
    </MoltThemeProvider>,
  );
}

const originalLocation = window.location;

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  Object.defineProperty(window, 'location', {
    value: {
      href: 'https://console.example.test/auth/settings',
      pathname: '/auth/settings',
      search: '',
      assign: mockAssign,
    },
    configurable: true,
  });
  mockCreateSettingsFlow.mockRejectedValue(
    responseError(401, { error: { id: 'session_inactive' } }),
  );
  mockGetSettingsFlow.mockRejectedValue(
    responseError(401, { error: { id: 'session_inactive' } }),
  );
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: originalLocation,
    configurable: true,
  });
});

describe('AuthPage settings session recovery', () => {
  it.each(['', '?flow=expired-session-flow'])(
    'enters login with a fresh settings destination for an inactive session (%s)',
    async (search) => {
      window.location.search = search;

      renderPage();

      await waitFor(() => expect(mockAssign).toHaveBeenCalledOnce());
      const login = new URL(mockAssign.mock.calls[0][0] as string);
      expect(login.origin + login.pathname).toBe(
        'https://console.example.test/auth/login',
      );
      expect(login.searchParams.get('return_to')).toBe(
        'https://console.example.test/auth/settings',
      );
      expect(screen.queryByText('Unable to continue')).not.toBeInTheDocument();
      expect(mockCreateSettingsFlow).toHaveBeenCalledTimes(search ? 0 : 1);
      expect(mockGetSettingsFlow).toHaveBeenCalledTimes(search ? 1 : 0);
    },
  );

  it('preserves public settings context inside the login destination without navigating to return_to', async () => {
    window.location.search = `?${new URLSearchParams({
      flow: 'old-flow',
      return_to: 'https://unapproved.example.test/after?state=opaque',
      organization: 'organization-id',
    })}`;

    renderPage();

    await waitFor(() => expect(mockAssign).toHaveBeenCalledOnce());
    const login = new URL(mockAssign.mock.calls[0][0] as string);
    const settings = new URL(login.searchParams.get('return_to')!);
    expect(settings.origin + settings.pathname).toBe(
      'https://console.example.test/auth/settings',
    );
    expect(settings.searchParams.has('flow')).toBe(false);
    expect(settings.searchParams.get('organization')).toBe('organization-id');
    expect(settings.searchParams.get('return_to')).toBe(
      'https://unapproved.example.test/after?state=opaque',
    );
  });

  it('also enters login if a missing settings flow restarts without a session', async () => {
    window.location.search = '?flow=missing-flow';
    mockGetSettingsFlow.mockRejectedValue(responseError(404, {}));

    renderPage();

    await waitFor(() => expect(mockAssign).toHaveBeenCalledOnce());
    expect(mockGetSettingsFlow).toHaveBeenCalledOnce();
    expect(mockCreateSettingsFlow).toHaveBeenCalledOnce();
  });

  it('prefers an explicit backend redirect over the inactive-session fallback', async () => {
    const redirect =
      'https://auth.example.test/self-service/login/browser?aal=aal2';
    mockCreateSettingsFlow.mockRejectedValue(
      responseError(401, {
        error: { id: 'session_inactive' },
        redirect_browser_to: redirect,
      }),
    );

    renderPage();

    await waitFor(() =>
      expect(mockAssign).toHaveBeenCalledExactlyOnceWith(redirect),
    );
  });

  it('does not treat unrelated settings authorization errors as an inactive session', async () => {
    mockCreateSettingsFlow.mockRejectedValue(
      responseError(401, { error: { id: 'other_error' } }),
    );

    renderPage();

    expect(await screen.findByText('Unable to continue')).toBeInTheDocument();
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it('does not redirect unrelated login 401 errors', async () => {
    mockCreateLoginFlow.mockRejectedValue(
      responseError(401, { error: { id: 'session_inactive' } }),
    );

    renderPage('login');

    expect(await screen.findByText('Unable to continue')).toBeInTheDocument();
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it('does not redirect after unmount when the settings request completes late', async () => {
    let rejectRequest!: (error: unknown) => void;
    mockCreateSettingsFlow.mockReturnValue(
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
    );
    const view = renderPage();
    view.unmount();

    await act(async () => {
      rejectRequest(responseError(401, { error: { id: 'session_inactive' } }));
    });

    expect(mockCreateSettingsFlow.mock.calls[0][1].signal.aborted).toBe(true);
    expect(mockAssign).not.toHaveBeenCalled();
  });
});

describe('AuthPage existing session', () => {
  it.each([
    ['login', mockCreateLoginFlow],
    ['registration', mockCreateRegistrationFlow],
    ['recovery', mockCreateRecoveryFlow],
  ] as const)(
    'hands %s to the Kratos browser endpoint when a session already exists',
    async (page, createFlow) => {
      window.location.search = `?${new URLSearchParams({
        return_to: 'https://app.example.test/after',
        login_challenge: 'challenge-id',
      })}`;
      createFlow.mockRejectedValue(
        responseError(400, { error: { id: 'session_already_available' } }),
      );

      renderPage(page);

      await waitFor(() => expect(mockAssign).toHaveBeenCalledOnce());
      const destination = new URL(mockAssign.mock.calls[0][0] as string);
      expect(destination.origin + destination.pathname).toBe(
        `https://auth.example.test/self-service/${page}/browser`,
      );
      expect(destination.searchParams.get('return_to')).toBe(
        'https://app.example.test/after',
      );
      expect(destination.searchParams.get('login_challenge')).toBe(
        'challenge-id',
      );
      expect(screen.queryByText('Unable to continue')).not.toBeInTheDocument();
    },
  );

  it('drops the stale flow id when handing an existing session to Kratos', async () => {
    window.location.search = '?flow=old-flow&refresh=false';
    mockGetLoginFlow.mockRejectedValue(
      responseError(400, { error: { id: 'session_already_available' } }),
    );

    renderPage('login');

    await waitFor(() =>
      expect(mockAssign).toHaveBeenCalledExactlyOnceWith(
        'https://auth.example.test/self-service/login/browser?refresh=false',
      ),
    );
  });

  it('keeps other 400 errors visible', async () => {
    mockCreateLoginFlow.mockRejectedValue(
      responseError(400, { error: { id: 'browser_location_change_required' } }),
    );

    renderPage('login');

    expect(await screen.findByText('Unable to continue')).toBeInTheDocument();
    expect(mockAssign).not.toHaveBeenCalled();
  });
});

describe('AuthPage OAuth error', () => {
  it('renders Hydra error parameters as plain text', async () => {
    window.location.search = `?${new URLSearchParams({
      error: 'invalid_request',
      error_description: '<b>Bad</b> redirect_uri',
    })}`;

    const view = renderPage('error');

    expect(await screen.findByText('invalid_request')).toBeInTheDocument();
    expect(screen.getByText('<b>Bad</b> redirect_uri')).toBeInTheDocument();
    expect(view.container.querySelector('b')).toBeNull();
    expect(mockGetFlowError).not.toHaveBeenCalled();
  });
});
