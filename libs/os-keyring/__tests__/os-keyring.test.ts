import { beforeEach, describe, expect, it, vi } from 'vitest';

import keyringConformance from '../../../testdata/keyring-conformance.json';

const keyring = vi.hoisted(() => ({
  deleteCredential: vi.fn(),
  getPassword: vi.fn(),
  getSecret: vi.fn(),
  setPassword: vi.fn(),
  setSecret: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    constructor(service: string, key: string) {
      keyring.constructor(service, key);
    }

    getSecret = keyring.getSecret;
    getPassword = keyring.getPassword;
    setSecret = keyring.setSecret;
    setPassword = keyring.setPassword;
    deleteCredential = keyring.deleteCredential;
  },
}));

import { OSKeyringSecretProvider, windowsKeyringTarget } from '../src/index.js';

describe('OSKeyringSecretProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keyring.getPassword.mockResolvedValue(undefined);
    keyring.getSecret.mockResolvedValue(undefined);
  });

  it('uses the stable service name on Linux', async () => {
    const key = 'oauth2/identity/client';
    const linuxSecrets = {
      read: vi.fn().mockResolvedValue('secret'),
      write: vi.fn(),
      delete: vi.fn(),
    };
    const provider = new OSKeyringSecretProvider(
      'linux',
      undefined,
      linuxSecrets,
    );

    await expect(provider.read(key)).resolves.toBe('secret');
    await provider.write(key, 'new-secret');
    await provider.delete(key);

    expect(linuxSecrets.read).toHaveBeenCalledWith('themolt.net', key);
    expect(linuxSecrets.write).toHaveBeenCalledWith(
      'themolt.net',
      key,
      'new-secret',
    );
    expect(linuxSecrets.delete).toHaveBeenCalledWith('themolt.net', key);
  });

  it('propagates Linux Secret Service failures', async () => {
    const linuxSecrets = {
      read: vi.fn().mockRejectedValue(new Error('unavailable')),
      write: vi.fn(),
      delete: vi.fn(),
    };
    const provider = new OSKeyringSecretProvider(
      'linux',
      undefined,
      linuxSecrets,
    );

    await expect(provider.read('key')).rejects.toThrow(/unavailable/);
  });

  it('uses Go-compatible raw bytes and target on Windows', async () => {
    const vector = keyringConformance.windows[0];
    const windowsCredentials = {
      read: vi.fn().mockResolvedValue(Buffer.from('secret')),
      write: vi.fn(),
      delete: vi.fn(),
    };
    const provider = new OSKeyringSecretProvider('win32', windowsCredentials);

    await expect(provider.read(vector.key)).resolves.toBe('secret');
    await provider.write(vector.key, '秘密');
    await provider.delete(vector.key);

    expect(windowsKeyringTarget(vector.service, vector.key, 'win32')).toBe(
      vector.target,
    );
    expect(windowsCredentials.write).toHaveBeenCalledWith(
      vector.target,
      vector.key,
      Buffer.from('秘密'),
    );
  });

  it('uses the Go-compatible password representation on macOS', async () => {
    keyring.getPassword.mockResolvedValue('秘密');
    keyring.setPassword.mockResolvedValue(undefined);
    const provider = new OSKeyringSecretProvider('darwin');

    await expect(provider.read('key')).resolves.toBe('秘密');
    await provider.write('key', 'new-secret');

    expect(keyring.setPassword).toHaveBeenCalledWith('new-secret');
  });

  it('fails closed when macOS deletion cannot be confirmed', async () => {
    keyring.deleteCredential.mockResolvedValue(false);
    const provider = new OSKeyringSecretProvider('darwin');

    await expect(provider.delete('key')).rejects.toThrow(/could not confirm/);
  });
});
