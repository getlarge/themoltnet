import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { desktopBridge, type DesktopStatus } from './bridge.js';

vi.mock('./bridge.js', () => ({
  INITIAL_STATUS: {
    state: 'checking',
    installedVersion: null,
    availableVersion: null,
    trustFingerprint: null,
    trusted: false,
    message: 'Checking the local agent bundle…',
    logs: [],
  },
  desktopBridge: {
    status: vi.fn(),
    install: vi.fn(),
    trust: vi.fn(),
    retry: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    checkForUpdates: vi.fn(),
    installUpdate: vi.fn(),
    openConsole: vi.fn(),
    openLogs: vi.fn(),
    removeTrust: vi.fn(),
    remove: vi.fn(),
    quit: vi.fn(),
    checkDesktopUpdate: vi.fn(),
    installDesktopUpdate: vi.fn(),
    subscribe: vi.fn().mockResolvedValue(() => undefined),
    subscribeRemoveRequest: vi.fn().mockResolvedValue(() => undefined),
  },
}));

const status = (overrides: Partial<DesktopStatus> = {}): DesktopStatus => ({
  state: 'running',
  installedVersion: '0.56.2',
  availableVersion: null,
  trustFingerprint: 'AA:BB:CC',
  trusted: true,
  message: 'Ready for Console pairing.',
  logs: ['server listening on https://127.0.0.1:17374'],
  ...overrides,
});

function renderApp() {
  return render(
    <MoltThemeProvider mode="dark">
      <App />
    </MoltThemeProvider>,
  );
}

let publishStatus: ((status: DesktopStatus) => void) | undefined;
let requestRemove: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(desktopBridge.status).mockResolvedValue(status());
  vi.mocked(desktopBridge.retry).mockResolvedValue(status());
  vi.mocked(desktopBridge.start).mockResolvedValue(status());
  vi.mocked(desktopBridge.stop).mockResolvedValue(status({ state: 'stopped' }));
  vi.mocked(desktopBridge.subscribe).mockImplementation((handler) => {
    publishStatus = handler;
    return Promise.resolve(() => undefined);
  });
  vi.mocked(desktopBridge.subscribeRemoveRequest).mockImplementation(
    (handler) => {
      requestRemove = handler;
      return Promise.resolve(() => undefined);
    },
  );
});

describe('MoltNet Agent desktop renderer', () => {
  it('puts the live server controls in the primary surface', async () => {
    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Agent Server running' }),
    ).toBeVisible();
    expect(
      screen.getByLabelText('Signature status: Local HTTPS trusted'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open Console' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Stop Agent Server' }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Stop Agent Server' }));
    await waitFor(() => expect(desktopBridge.stop).toHaveBeenCalledOnce());
  });

  it('requires confirmation before changing macOS trust', async () => {
    vi.mocked(desktopBridge.status).mockResolvedValue(
      status({ state: 'needs_trust', trusted: false }),
    );
    vi.mocked(desktopBridge.trust).mockResolvedValue(status());
    renderApp();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Enable local HTTPS' }),
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Enable MoltNet local HTTPS?',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trust local CA' }));

    await waitFor(() => expect(desktopBridge.trust).toHaveBeenCalledOnce());
  });

  it('preserves configuration and keeps CA cleanup a separate opt-in', async () => {
    vi.mocked(desktopBridge.remove).mockResolvedValue(
      status({ state: 'removed', installedVersion: null }),
    );
    renderApp();

    fireEvent.click(await screen.findByText('Maintenance'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove agent bundle…' }),
    );
    expect(screen.getByText(/\.config\/moltnet are preserved/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Remove local CA…' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Stop the Agent Server before removing local trust.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove bundle' }));
    await waitFor(() =>
      expect(desktopBridge.remove).toHaveBeenCalledWith(false),
    );
  });

  it('explains that development builds do not use the release channel', async () => {
    vi.mocked(desktopBridge.checkDesktopUpdate).mockResolvedValue({
      availableVersion: null,
      message: 'App updates are checked only by signed MoltNet Agent builds.',
    });
    renderApp();

    fireEvent.click(await screen.findByText('Maintenance'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Check app update' }),
    );

    expect(await screen.findByText('App update status')).toBeVisible();
    expect(
      screen.getByText(
        'App updates are checked only by signed MoltNet Agent builds.',
      ),
    ).toBeVisible();
  });

  it('describes update states as a lifecycle branch', async () => {
    vi.mocked(desktopBridge.status).mockResolvedValue(
      status({ state: 'update_available', availableVersion: '0.57.0' }),
    );
    renderApp();

    fireEvent.click(await screen.findByText('Maintenance'));
    expect(
      await screen.findByRole('button', {
        name: 'Install 0.57.0',
      }),
    ).toBeEnabled();
  });

  it('surfaces operation failures and lets a failed lifecycle retry', async () => {
    const error = 'Agent Server could not bind its port';
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.mocked(desktopBridge.status).mockResolvedValue(
      status({ state: 'failed', message: 'The Agent Server exited.' }),
    );
    vi.mocked(desktopBridge.start).mockRejectedValue(error);
    renderApp();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Start Agent Server' }),
    );

    expect(
      await screen.findByText('Agent Server could not bind its port'),
    ).toBeVisible();
    expect(consoleError).toHaveBeenCalledWith(error);
  });

  it('renders status and removal requests received from Tauri events', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Agent Server running' });

    act(() => publishStatus?.(status({ state: 'stopped' })));
    expect(
      screen.getByRole('heading', { name: 'Agent Server stopped' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Start Agent Server' }),
    ).toBeEnabled();

    act(() => requestRemove?.());
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Remove the agent bundle?',
    );
  });

  it('guards confirmed operations against repeated activation', async () => {
    vi.mocked(desktopBridge.status).mockResolvedValue(
      status({ state: 'needs_trust', trusted: false }),
    );
    let finishTrust: ((next: DesktopStatus) => void) | undefined;
    vi.mocked(desktopBridge.trust).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishTrust = resolve;
        }),
    );
    renderApp();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Enable local HTTPS' }),
    );
    const confirm = screen.getByRole('button', { name: 'Trust local CA' });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(desktopBridge.trust).toHaveBeenCalledOnce();
    act(() => finishTrust?.(status()));
  });
});
