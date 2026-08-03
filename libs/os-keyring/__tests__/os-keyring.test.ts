import { beforeEach, describe, expect, it, vi } from 'vitest';

import keyringConformance from '../../../testdata/keyring-conformance.json';

const keyring = vi.hoisted(() => ({
  deleteCredential: vi.fn(),
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    constructor(service: string, key: string) {
      keyring.constructor(service, key);
    }

    getSecret = keyring.getSecret;
    setSecret = keyring.setSecret;
    deleteCredential = keyring.deleteCredential;
  },
}));

import { OSKeyringSecretProvider, windowsKeyringTarget } from '../src/index.js';

describe('OSKeyringSecretProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keyring.getSecret.mockResolvedValue(undefined);
  });

  it('uses the stable service name on Linux', async () => {
    const key = 'oauth2/identity/client';
    keyring.getSecret.mockResolvedValue(Buffer.from('secret'));
    keyring.setSecret.mockResolvedValue(undefined);
    keyring.deleteCredential.mockResolvedValue(true);
    const provider = new OSKeyringSecretProvider('linux');

    await expect(provider.read(key)).resolves.toBe('secret');
    await provider.write(key, 'new-secret');
    await provider.delete(key);

    expect(keyring.constructor).toHaveBeenCalledTimes(3);
    expect(keyring.constructor).toHaveBeenNthCalledWith(1, 'themolt.net', key);
    expect(keyring.setSecret).toHaveBeenCalledWith(Buffer.from('new-secret'));
    expect(keyring.deleteCredential).toHaveBeenCalledOnce();
  });

  it('propagates Linux keyring enumeration failures', async () => {
    keyring.getSecret.mockRejectedValue(new Error('unavailable'));
    const provider = new OSKeyringSecretProvider('linux');

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

  it('uses Go-compatible base64 bytes on macOS', async () => {
    const stored =
      'go-keyring-base64:' + Buffer.from('秘密').toString('base64');
    keyring.getSecret.mockResolvedValue(Buffer.from(stored));
    keyring.setSecret.mockResolvedValue(undefined);
    const provider = new OSKeyringSecretProvider('darwin');

    await expect(provider.read('key')).resolves.toBe('秘密');
    await provider.write('key', 'new-secret');

    expect(keyring.setSecret).toHaveBeenCalledWith(
      Buffer.from(
        'go-keyring-base64:' + Buffer.from('new-secret').toString('base64'),
      ),
    );
  });

  it('fails closed when deletion cannot be confirmed', async () => {
    keyring.deleteCredential.mockResolvedValue(false);
    const provider = new OSKeyringSecretProvider('linux');

    await expect(provider.delete('key')).rejects.toThrow(/could not confirm/);
  });
});
