import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ConnectionSettingsView,
  desktopBridge,
  INITIAL_STATUS,
} from './bridge.js';
import { ConnectionSettings } from './ConnectionSettings.js';

vi.mock('./bridge.js', () => ({
  INITIAL_STATUS: { state: 'running' },
  desktopBridge: {
    connectionSettings: vi.fn(),
    applyConnectionSettings: vi.fn(),
  },
}));
const defaults = {
  apiUrl: 'https://api.themolt.net',
  issuer: 'https://auth.themolt.net',
  publicUrl: 'https://auth.themolt.net',
  nativeClientId: 'moltnet-native',
};
const view: ConnectionSettingsView = {
  defaults,
  effective: defaults,
  overrides: {},
  environment: {},
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(desktopBridge.connectionSettings).mockResolvedValue(view);
  vi.mocked(desktopBridge.applyConnectionSettings).mockResolvedValue(
    INITIAL_STATUS,
  );
});
function setup(running = true) {
  const apply = vi.fn(async (operation: () => Promise<unknown>) => {
    await operation();
    return true;
  });
  render(
    <MoltThemeProvider mode="dark">
      <ConnectionSettings running={running} busy={false} apply={apply} />
    </MoltThemeProvider>,
  );
  fireEvent.click(screen.getByText('Advanced connection settings'));
  return apply;
}
describe('advanced connection settings', () => {
  it('loads on disclosure, confirms before restart, and passes only overrides', async () => {
    const apply = setup();
    const input = await screen.findByLabelText('MoltNet API URL');
    fireEvent.change(input, { target: { value: 'https://api.example' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply and restart server' }),
    );
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply and restart' }));
    await waitFor(() =>
      expect(desktopBridge.applyConnectionSettings).toHaveBeenCalledWith({
        apiUrl: 'https://api.example',
      }),
    );
  });
  it('keeps launch-managed values read-only while resetting local overrides', async () => {
    vi.mocked(desktopBridge.connectionSettings).mockResolvedValue({
      ...view,
      overrides: { issuer: 'https://auth.example' },
      environment: { apiUrl: 'http://localhost:8080' },
    });
    setup();
    expect(await screen.findByLabelText('MoltNet API URL')).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset to release defaults' }),
    );
    expect(screen.getByLabelText('OAuth issuer')).toHaveValue(defaults.issuer);
    expect(screen.getByLabelText('MoltNet API URL')).toHaveValue(
      'http://localhost:8080',
    );
  });
  it('explains that the server must be started before native administration', () => {
    setup(false);
    expect(
      screen.getByText(
        'Start the Agent Server to manage its connection settings.',
      ),
    ).toBeVisible();
    expect(desktopBridge.connectionSettings).not.toHaveBeenCalled();
  });
});
