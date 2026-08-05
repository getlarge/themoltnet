import { describe, expect, it, vi } from 'vitest';

import keyringConformance from '../../../testdata/keyring-conformance.json';
import {
  createPlatformKeyringSecretProvider,
  windowsKeyringTarget,
} from '../src/index.js';

describe('Windows keyring provider', () => {
  it('uses the keytar target and Go-compatible UTF-8 representation', async () => {
    const vector = keyringConformance.windows[0];
    const keychain = {
      getPassword: vi.fn().mockResolvedValue('秘密'),
      setPassword: vi.fn(),
      deletePassword: vi.fn().mockResolvedValue(true),
    };
    const provider = createPlatformKeyringSecretProvider(keychain);

    await expect(provider.read(vector.key)).resolves.toBe('秘密');
    await provider.write(vector.key, 'new-secret');

    expect(windowsKeyringTarget(vector.service, vector.key)).toBe(
      vector.target,
    );
    expect(keychain.getPassword).toHaveBeenCalledWith(
      vector.service,
      vector.key,
    );
    expect(keychain.setPassword).toHaveBeenCalledWith(
      vector.service,
      vector.key,
      'new-secret',
    );
  });

  it('fails closed when deletion cannot be confirmed', async () => {
    const keychain = {
      getPassword: vi.fn().mockResolvedValue('still-present'),
      setPassword: vi.fn(),
      deletePassword: vi.fn().mockResolvedValue(false),
    };
    const provider = createPlatformKeyringSecretProvider(keychain);

    await expect(provider.delete('key')).rejects.toThrow(/could not confirm/);
  });
});
