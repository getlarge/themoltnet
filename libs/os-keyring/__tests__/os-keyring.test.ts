import { describe, expect, it, vi } from 'vitest';

import {
  decodeGoKeyringPassword,
  encodeGoKeyringPassword,
  OSKeyringSecretProvider,
  windowsKeyringTarget,
} from '../src/index.js';

describe('OSKeyringSecretProvider', () => {
  it('loads keytar once and reads the requested service and account', async () => {
    const keytar = {
      getPassword: vi.fn().mockResolvedValue('secret'),
      setPassword: vi.fn(),
      deletePassword: vi.fn(),
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
      setPassword: vi.fn(),
      deletePassword: vi.fn(),
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
      setPassword: vi.fn(),
      deletePassword: vi.fn(),
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
  it('advertises read-write capabilities', () => {
    expect(new OSKeyringSecretProvider('linux', vi.fn()).capabilities).toEqual({
      read: true,
      write: true,
      delete: true,
    });
  });

  it('writes the raw value on linux and windows', async () => {
    const keytar = {
      getPassword: vi.fn(),
      setPassword: vi.fn().mockResolvedValue(undefined),
      deletePassword: vi.fn(),
    };
    const load = async () => keytar;

    await new OSKeyringSecretProvider('linux', load).write('k', 'secret-秘密');
    await new OSKeyringSecretProvider('win32', load).write('k', 'secret-秘密');

    expect(keytar.setPassword).toHaveBeenNthCalledWith(
      1,
      'themolt.net',
      'k',
      'secret-秘密',
    );
    expect(keytar.setPassword).toHaveBeenNthCalledWith(
      2,
      'themolt.net',
      'k',
      'secret-秘密',
    );
  });

  it('writes the Go base64 representation on macOS so moltnet can read it back', async () => {
    const keytar = {
      getPassword: vi.fn(),
      setPassword: vi.fn().mockResolvedValue(undefined),
      deletePassword: vi.fn(),
    };

    await new OSKeyringSecretProvider('darwin', async () => keytar).write(
      'k',
      'secret-秘密',
    );

    const stored = keytar.setPassword.mock.calls[0][2] as string;
    expect(stored).toBe(
      'go-keyring-base64:' + Buffer.from('secret-秘密').toString('base64'),
    );
    expect(decodeGoKeyringPassword(stored)).toBe('secret-秘密');
    expect(encodeGoKeyringPassword('plain')).toBe(
      'go-keyring-base64:' + Buffer.from('plain').toString('base64'),
    );
  });

  it('deletes without failing on a missing entry', async () => {
    const keytar = {
      getPassword: vi.fn(),
      setPassword: vi.fn(),
      deletePassword: vi.fn().mockResolvedValue(false),
    };
    const provider = new OSKeyringSecretProvider('linux', async () => keytar);

    await expect(provider.delete('missing')).resolves.toBeUndefined();
    expect(keytar.deletePassword).toHaveBeenCalledWith(
      'themolt.net',
      'missing',
    );
  });

  it('probes without returning the value', async () => {
    const keytar = {
      getPassword: vi
        .fn()
        .mockResolvedValueOnce('secret')
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('locked')),
      setPassword: vi.fn(),
      deletePassword: vi.fn(),
    };
    const provider = new OSKeyringSecretProvider('linux', async () => keytar);

    await expect(provider.probe('k')).resolves.toBe('present');
    await expect(provider.probe('k')).resolves.toBe('absent');
    await expect(provider.probe('k')).resolves.toBe('inaccessible');
  });

  it('rejects write and delete on unsupported platforms before loading bindings', async () => {
    const load = vi.fn();
    const provider = new OSKeyringSecretProvider('freebsd', load);

    await expect(provider.write('k', 'v')).rejects.toThrow(/not supported/);
    await expect(provider.delete('k')).rejects.toThrow(/not supported/);
    expect(load).not.toHaveBeenCalled();
  });
});
