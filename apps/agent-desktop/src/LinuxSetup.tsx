import {
  Button,
  ConfirmDialog,
  InlineNotice,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { useEffect, useState } from 'react';

import {
  desktopBridge,
  type LinuxRepair,
  type LinuxSetupStatus,
} from './bridge.js';

export function LinuxSetup() {
  const [status, setStatus] = useState<LinuxSetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<LinuxRepair | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async (clearError = true) => {
    try {
      setStatus(await desktopBridge.linuxSetup());
      if (clearError) setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const repair = async (action: LinuxRepair) => {
    setPending(null);
    setBusy(true);
    setError(null);
    try {
      await desktopBridge.repairLinuxSetup(action);
    } catch (cause) {
      setError(String(cause));
    } finally {
      await refresh(false);
      setBusy(false);
    }
  };
  if (!status?.linux)
    return error ? (
      <InlineNotice tone="error" title="Could not check system requirements">
        {error}
        <Button variant="ghost" onClick={() => void refresh()}>
          Retry
        </Button>
      </InlineNotice>
    ) : null;
  return (
    <section aria-label="Linux system requirements">
      <Stack gap={3}>
        <Text variant="h3">System requirements</Text>
        <Text color="secondary">{status.distribution}</Text>
        <Text>
          Sandbox tools: {status.qemuReady ? 'Installed' : 'QEMU is missing'}
        </Text>
        <Text>
          Secret storage:{' '}
          {status.secretServiceAvailable
            ? 'Secret Service is available — unlock it when prompted'
            : status.keyringInstalled
              ? 'Keyring installed but not advertised by this desktop session'
              : 'GNOME Keyring is missing'}
        </Text>
        <Text>
          Hardware acceleration:{' '}
          {status.kvmAccessible
            ? 'Available'
            : status.kvmPendingRelogin
              ? 'Enabled — sign out and back in to activate it'
              : status.kvmPresent
                ? 'Your account needs KVM access'
                : 'KVM is unavailable on this machine'}
        </Text>
        <Text variant="caption" color="secondary">
          Sandboxed workers need QEMU and hardware acceleration. Credentials
          need an unlocked system keyring. You can use the rest of Desktop while
          completing setup.
        </Text>
        {error ? (
          <InlineNotice tone="error" title="System setup could not finish">
            {error}
          </InlineNotice>
        ) : null}
        {status.kvmPendingRelogin ? (
          <InlineNotice
            tone="info"
            title="Sign out of Ubuntu and sign in again"
          >
            Your new KVM group membership takes effect in a new desktop session.
          </InlineNotice>
        ) : null}
        {!status.canInstall ? (
          <Text variant="caption">
            Automatic setup supports Ubuntu 24.04 with a system authorization
            agent. On other systems, install QEMU and a Secret Service keyring
            using your package manager.
          </Text>
        ) : null}
        <Stack direction="row" gap={3} wrap>
          {(!status.qemuReady ||
            (!status.keyringInstalled && !status.secretServiceAvailable)) &&
          status.canInstall ? (
            <Button
              disabled={busy}
              onClick={() => setPending('install_dependencies')}
            >
              Install requirements…
            </Button>
          ) : null}
          {!status.kvmAccessible && status.canEnableKvm ? (
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => setPending('enable_kvm')}
            >
              Enable hardware acceleration…
            </Button>
          ) : null}
          <Button
            disabled={busy}
            variant="ghost"
            onClick={() => void refresh()}
          >
            Check again
          </Button>
        </Stack>
        {busy ? (
          <div role="status">
            Waiting for system setup. Complete the Ubuntu authorization prompt.
          </div>
        ) : null}
      </Stack>
      <ConfirmDialog
        open={pending !== null}
        title={
          pending === 'enable_kvm'
            ? 'Allow this account to use KVM?'
            : 'Install system requirements?'
        }
        message={
          pending === 'enable_kvm'
            ? `Ubuntu will ask for administrator authorization to add your current account to the kvm group. This permits hardware-accelerated virtual machines. Sign out and back in afterward. Command: ${status.enableKvmCommand}.`
            : `Ubuntu will ask for administrator authorization to install QEMU and a Secret Service from your configured package repositories. Command: ${status.installCommand}. You can cancel and install them later.`
        }
        confirmLabel="Continue to authorization"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) void repair(pending);
        }}
      />
    </section>
  );
}
