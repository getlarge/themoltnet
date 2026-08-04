import { describe, expect, it, vi } from 'vitest';

import { createPlatformKeyringSecretProvider } from '../src/index.js';

describe('macOS keyring provider', () => {
  it('uses the Go-compatible password representation', async () => {
    const keychain = {
      getPassword: vi
        .fn()
        .mockResolvedValue(
          'go-keyring-base64:' + Buffer.from('秘密').toString('base64'),
        ),
      setPassword: vi.fn(),
      deletePassword: vi.fn().mockResolvedValue(true),
    };
    const provider = createPlatformKeyringSecretProvider(keychain);

    await expect(provider.read('key')).resolves.toBe('秘密');
    await provider.write('key', 'new-secret');

    expect(keychain.setPassword).toHaveBeenCalledWith(
      'themolt.net',
      'key',
      'go-keyring-base64:' + Buffer.from('new-secret').toString('base64'),
    );
  });

  it('fails closed when deletion cannot be confirmed', async () => {
    const keychain = {
      getPassword: vi.fn().mockResolvedValue('still-present'),
      setPassword: vi.fn(),
      deletePassword: vi.fn().mockResolvedValue(true),
    };
    const provider = createPlatformKeyringSecretProvider(keychain);

    await expect(provider.delete('key')).rejects.toThrow(/could not confirm/);
  });
});
