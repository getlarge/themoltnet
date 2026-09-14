import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

beforeEach(() => {
  vi.mocked(desktopBridge.status).mockResolvedValue(status());
});

describe('MoltNet Agent desktop renderer', () => {
  it('shows non-color lifecycle and verified trust status', async () => {
    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Agent Server running' }),
    ).toBeVisible();
    expect(
      screen.getByLabelText('Signature status: Local HTTPS trusted'),
    ).toBeVisible();
    expect(
      screen.getByRole('list', { name: 'Agent setup progress' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open Console' })).toBeEnabled();
  });

  it('requires confirmation before changing macOS trust', async () => {
    vi.mocked(desktopBridge.status).mockResolvedValue(
      status({ state: 'needs_trust', trusted: false }),
    );
    vi.mocked(desktopBridge.trust).mockResolvedValue(status());
    renderApp();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Review local HTTPS trust' }),
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Trust MoltNet local HTTPS?',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trust local CA' }));

    await waitFor(() => expect(desktopBridge.trust).toHaveBeenCalledOnce());
  });

  it('preserves configuration and keeps CA cleanup a separate opt-in', async () => {
    vi.mocked(desktopBridge.remove).mockResolvedValue(
      status({ state: 'removed', installedVersion: null }),
    );
    renderApp();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove agent bundle' }),
    );
    expect(screen.getByText(/\.config\/moltnet are preserved/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Remove local CA…' }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove bundle' }));
    await waitFor(() =>
      expect(desktopBridge.remove).toHaveBeenCalledWith(false),
    );
  });

  it('reports when the desktop app is already up to date', async () => {
    vi.mocked(desktopBridge.checkDesktopUpdate).mockResolvedValue(null);
    renderApp();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Check app update' }),
    );

    expect(
      await screen.findByText('MoltNet Agent is up to date'),
    ).toBeVisible();
    expect(screen.getByText('No desktop update is available.')).toBeVisible();
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
      screen.getByText('Current lifecycle branch: Update available.'),
    ).toBeVisible();
  });
});
