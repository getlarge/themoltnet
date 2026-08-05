import { describe, expect, it, vi } from 'vitest';

const dbus = vi.hoisted(() => ({
  disconnect: vi.fn(),
  getProxyObject: vi.fn(() => new Promise(() => {})),
}));

vi.mock('@jellybrick/dbus-next', () => ({
  sessionBus: () => dbus,
  Variant: class {},
}));

import {
  createLinuxSecretStore,
  createPlatformKeyringSecretProvider,
  LinuxSecretServiceTimeoutError,
} from '../src/index.js';

describe('Linux keyring provider', () => {
  it('uses the stable Secret Service name', async () => {
    const secrets = {
      read: vi.fn().mockResolvedValue('secret'),
      write: vi.fn(),
      delete: vi.fn(),
    };
    const provider = createPlatformKeyringSecretProvider(secrets);

    await expect(provider.read('key')).resolves.toBe('secret');
    await provider.write('key', 'new-secret');
    await provider.delete('key');

    expect(secrets.read).toHaveBeenCalledWith('themolt.net', 'key');
    expect(secrets.write).toHaveBeenCalledWith(
      'themolt.net',
      'key',
      'new-secret',
    );
    expect(secrets.delete).toHaveBeenCalledWith('themolt.net', 'key');
  });

  it('propagates Secret Service failures', async () => {
    const provider = createPlatformKeyringSecretProvider({
      read: vi.fn().mockRejectedValue(new Error('unavailable')),
      write: vi.fn(),
      delete: vi.fn(),
    });

    await expect(provider.read('key')).rejects.toThrow(/unavailable/);
  });

  it('times out and disconnects when Secret Service does not respond', async () => {
    vi.useFakeTimers();
    const result = expect(
      createLinuxSecretStore().read('themolt.net', 'key'),
    ).rejects.toBeInstanceOf(LinuxSecretServiceTimeoutError);

    await vi.advanceTimersByTimeAsync(30_000);

    await result;
    expect(dbus.disconnect).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
