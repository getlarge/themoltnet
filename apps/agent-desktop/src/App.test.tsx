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
    message: 'Checking the local agent bundle…',
    logs: [],
  },
  desktopBridge: {
    status: vi.fn(),
    install: vi.fn(),
    retry: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    checkForUpdates: vi.fn(),
    installUpdate: vi.fn(),
    openLogs: vi.fn(),
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
  message: 'Ready for local work.',
  logs: ['server listening on private native socket'],
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
  it('shows non-color lifecycle and active native control status', async () => {
    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Agent Server running' }),
    ).toBeVisible();
    expect(
      screen.getByLabelText('Signature status: Native control active'),
    ).toBeVisible();
    expect(
      screen.queryByRole('list', { name: 'Agent setup progress' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop Agent Server' }));
    await waitFor(() => expect(desktopBridge.stop).toHaveBeenCalledOnce());
  });

  it('preserves configuration when removing the agent bundle', async () => {
    vi.mocked(desktopBridge.remove).mockResolvedValue(
      status({ state: 'removed', installedVersion: null }),
    );
    renderApp();

    fireEvent.click(screen.getByText('Maintenance'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove agent bundle' }),
    );
    expect(screen.getByText(/\.config\/moltnet are preserved/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove bundle' }));
    await waitFor(() => expect(desktopBridge.remove).toHaveBeenCalledWith());
  });

  it('reports when the desktop app is already up to date', async () => {
    vi.mocked(desktopBridge.checkDesktopUpdate).mockResolvedValue({
      availableVersion: null,
      message: 'App updates are checked only by signed MoltNet Agent builds.',
    });
    renderApp();

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

    expect(
      await screen.findByRole('button', {
        name: 'Review Agent CLI update',
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole('heading', { name: 'Update available' }),
    ).toBeVisible();
    expect(
      screen.getByLabelText('Signature status: Native control active'),
    ).toBeVisible();
  });

  it('surfaces operation failures and lets a failed lifecycle retry', async () => {
    const error = 'Agent Server could not bind its port';
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.mocked(desktopBridge.status).mockResolvedValue(
      status({ state: 'failed', message: 'The Agent Server exited.' }),
    );
    vi.mocked(desktopBridge.retry).mockRejectedValue(error);
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

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
    expect(
      screen.getByLabelText('Signature status: Native connection idle'),
    ).toBeVisible();

    act(() => requestRemove?.());
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Remove the agent bundle?',
    );
  });

  it('guards confirmed operations against repeated activation', async () => {
    vi.mocked(desktopBridge.status).mockResolvedValue(
      status({ state: 'update_available', availableVersion: '0.57.0' }),
    );
    let finishUpdate: ((next: DesktopStatus) => void) | undefined;
    vi.mocked(desktopBridge.installUpdate).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpdate = resolve;
        }),
    );
    renderApp();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review Agent CLI update' }),
    );
    const confirm = screen.getByRole('button', { name: 'Install and restart' });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(desktopBridge.installUpdate).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog')).toBeVisible();
    act(() => finishUpdate?.(status()));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
