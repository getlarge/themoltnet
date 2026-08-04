import { describe, expect, it, vi } from 'vitest';

import { createPlatformKeyringSecretProvider } from '../src/index.js';

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
});
