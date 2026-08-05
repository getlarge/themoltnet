import { describe, expect, it, vi } from 'vitest';

import { OSKeyringSecretProvider, windowsKeyringTarget } from '../src/index.js';

describe('OSKeyringSecretProvider', () => {
  it('loads the selected platform provider once', async () => {
    const backend = {
      name: 'os-keyring',
      read: vi.fn().mockResolvedValue('secret'),
      write: vi.fn(),
      delete: vi.fn(),
    };
    const load = vi.fn().mockResolvedValue(backend);
    const provider = new OSKeyringSecretProvider('linux', load);

    await expect(provider.read('key')).resolves.toBe('secret');
    await provider.write('key', 'new-secret');
    await provider.delete('key');

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith('linux');
    expect(backend.write).toHaveBeenCalledWith('key', 'new-secret');
  });

  it('does not load a platform package until the provider is used', () => {
    const load = vi.fn();

    new OSKeyringSecretProvider('darwin', load);

    expect(load).not.toHaveBeenCalled();
  });

  it('rejects unsupported platforms', async () => {
    const provider = new OSKeyringSecretProvider('freebsd');

    await expect(provider.read('key')).rejects.toThrow(
      /not supported on freebsd/,
    );
  });

  it('uses the Go-compatible Windows target', () => {
    expect(
      windowsKeyringTarget('themolt.net', 'oauth2/id/client', 'win32'),
    ).toBe('themolt.net/oauth2/id/client');
    expect(
      windowsKeyringTarget('themolt.net', 'oauth2/id/client', 'linux'),
    ).toBeUndefined();
  });
});
