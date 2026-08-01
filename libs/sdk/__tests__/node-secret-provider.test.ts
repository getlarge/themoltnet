import { beforeEach, describe, expect, it, vi } from 'vitest';

const keyring = vi.hoisted(() => ({
  deletePassword: vi.fn(),
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    constructor(service: string, key: string) {
      keyring.constructor(service, key);
    }

    getPassword = keyring.getPassword;
    setPassword = keyring.setPassword;
    deletePassword = keyring.deletePassword;
  },
}));

import {
  createNodeSecretProviderRegistry,
  OSKeyringSecretProvider,
} from '../src/node.js';

describe('OSKeyringSecretProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the stable service name for read, write, and delete', async () => {
    keyring.getPassword.mockResolvedValue('keyring-secret');
    keyring.setPassword.mockResolvedValue(undefined);
    keyring.deletePassword.mockResolvedValue(true);
    const provider = new OSKeyringSecretProvider();
    const key = 'oauth2/identity-123/client-456';

    await expect(provider.read(key)).resolves.toBe('keyring-secret');
    await provider.write(key, 'new-secret');
    await provider.delete(key);

    expect(keyring.constructor).toHaveBeenCalledTimes(3);
    expect(keyring.constructor).toHaveBeenNthCalledWith(1, 'themolt.net', key);
    expect(keyring.setPassword).toHaveBeenCalledWith('new-secret');
    expect(keyring.deletePassword).toHaveBeenCalledOnce();
  });

  it('registers both env and OS-keyring providers for Node consumers', async () => {
    keyring.getPassword.mockResolvedValue('resolved-secret');
    const registry = createNodeSecretProviderRegistry();

    await expect(
      registry.resolve({
        provider: 'os-keyring',
        key: 'oauth2/identity-123/client-456',
      }),
    ).resolves.toBe('resolved-secret');
    expect(registry.get('env')).toBeDefined();
  });
});
