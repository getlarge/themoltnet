import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopBridge, type LinuxSetupStatus } from './bridge.js';
import { LinuxSetup } from './LinuxSetup.js';

vi.mock('./bridge.js', () => ({
  desktopBridge: {
    linuxSetup: vi.fn(),
    repairLinuxSetup: vi.fn(),
  },
}));
const missing: LinuxSetupStatus = {
  linux: true,
  distribution: 'Ubuntu 24.04 LTS',
  canInstall: true,
  qemuReady: false,
  keyringInstalled: false,
  secretServiceAvailable: false,
  kvmPresent: true,
  kvmAccessible: false,
  kvmPendingRelogin: false,
  canEnableKvm: true,
  installCommand:
    'apt-get install --yes --no-remove --no-install-recommends qemu-utils qemu-system-x86 gnome-keyring libsecret-1-0 dbus-bin',
  enableKvmCommand: 'usermod --append --groups kvm -- alice',
};
function setup() {
  return render(
    <MoltThemeProvider>
      <LinuxSetup />
    </MoltThemeProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(desktopBridge.linuxSetup).mockResolvedValue(missing);
  vi.mocked(desktopBridge.repairLinuxSetup).mockResolvedValue(missing);
});
describe('Linux setup consent', () => {
  it('inspects without changing the system and cancellation does not repair', async () => {
    setup();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Install requirements…' }),
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('apt-get install');
    expect(desktopBridge.repairLinuxSetup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(desktopBridge.repairLinuxSetup).not.toHaveBeenCalled();
  });
  it('repairs only after confirmation and explains the new session requirement', async () => {
    vi.mocked(desktopBridge.linuxSetup)
      .mockResolvedValueOnce(missing)
      .mockResolvedValue({
        ...missing,
        canEnableKvm: false,
        kvmPendingRelogin: true,
      });
    setup();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Enable hardware acceleration…',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to authorization' }),
    );
    await waitFor(() =>
      expect(desktopBridge.repairLinuxSetup).toHaveBeenCalledWith('enable_kvm'),
    );
    expect(
      await screen.findByText('Sign out of Ubuntu and sign in again'),
    ).toBeInTheDocument();
    expect(desktopBridge.linuxSetup).toHaveBeenCalledTimes(2);
  });
  it('shows authorization cancellation without a second attempt', async () => {
    vi.mocked(desktopBridge.linuxSetup)
      .mockResolvedValueOnce(missing)
      .mockRejectedValueOnce(new Error('refresh failed'));
    vi.mocked(desktopBridge.repairLinuxSetup).mockRejectedValue(
      new Error('Authorization cancelled'),
    );
    setup();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Install requirements…' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to authorization' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Authorization cancelled',
    );
    expect(desktopBridge.repairLinuxSetup).toHaveBeenCalledTimes(1);
    expect(desktopBridge.linuxSetup).toHaveBeenCalledTimes(2);
  });
  it('distinguishes invalid KVM device permissions from a pending login', async () => {
    vi.mocked(desktopBridge.linuxSetup).mockResolvedValue({
      ...missing,
      canEnableKvm: false,
      kvmPendingRelogin: false,
    });
    setup();
    expect(
      await screen.findByText('KVM access needs attention'),
    ).toBeInTheDocument();
    expect(screen.getByText('/dev/kvm')).toBeInTheDocument();
    expect(
      screen.queryByText('Sign out of Ubuntu and sign in again'),
    ).not.toBeInTheDocument();
  });
  it('does not offer automatic repair on unsupported distributions', async () => {
    vi.mocked(desktopBridge.linuxSetup).mockResolvedValue({
      ...missing,
      canInstall: false,
      canEnableKvm: false,
      distribution: 'Fedora',
    });
    setup();
    await screen.findByText('Fedora');
    expect(
      screen.queryByRole('button', { name: 'Install requirements…' }),
    ).not.toBeInTheDocument();
    expect(desktopBridge.repairLinuxSetup).not.toHaveBeenCalled();
  });
});
