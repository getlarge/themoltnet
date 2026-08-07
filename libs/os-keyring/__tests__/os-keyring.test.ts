import { describe, expect, it, vi } from 'vitest';

import {
  decodeGoKeyringPassword,
  OSKeyringSecretProvider,
  windowsKeyringTarget,
} from '../src/index.js';

describe('OSKeyringSecretProvider', () => {
  it('loads keytar once and reads the requested service and account', async () => {
    const keytar = {
      getPassword: vi.fn().mockResolvedValue('secret'),
    };
    const load = vi.fn().mockResolvedValue(keytar);
    const provider = new OSKeyringSecretProvider('linux', load);

    await expect(provider.read('oauth2/id/client')).resolves.toBe('secret');
    await expect(provider.read('second')).resolves.toBe('secret');

    expect(load).toHaveBeenCalledOnce();
    expect(keytar.getPassword).toHaveBeenNthCalledWith(
      1,
      'themolt.net',
      'oauth2/id/client',
    );
  });

  it('does not load native bindings until the provider is used', () => {
    const load = vi.fn();

    new OSKeyringSecretProvider('darwin', load);

    expect(load).not.toHaveBeenCalled();
  });

  it('propagates native keyring failures', async () => {
    const failure = new Error('keychain is locked');
    const provider = new OSKeyringSecretProvider('linux', async () => ({
      getPassword: vi.fn().mockRejectedValue(failure),
    }));

    await expect(provider.read('key')).rejects.toBe(failure);
  });

  it('rejects unsupported platforms before loading native bindings', async () => {
    const load = vi.fn();
    const provider = new OSKeyringSecretProvider('freebsd', load);

    await expect(provider.read('key')).rejects.toThrow(
      /not supported on freebsd/,
    );
    expect(load).not.toHaveBeenCalled();
  });

  it('decodes the Go macOS keyring representation only on macOS', async () => {
    const stored =
      'go-keyring-base64:' + Buffer.from('secret-秘密').toString('base64');
    const load = async () => ({
      getPassword: vi.fn().mockResolvedValue(stored),
    });

    await expect(
      new OSKeyringSecretProvider('darwin', load).read('key'),
    ).resolves.toBe('secret-秘密');
    await expect(
      new OSKeyringSecretProvider('linux', load).read('key'),
    ).resolves.toBe(stored);
    expect(decodeGoKeyringPassword('plain')).toBe('plain');
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
