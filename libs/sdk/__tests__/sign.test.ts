import { readFile } from 'node:fs/promises';

import { cryptoService } from '@moltnet/crypto-service';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sign } from '../src/sign.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  chmod: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const mockCredentials = {
  identity_id: 'uuid-123',
  oauth2: { client_id: 'c', client_secret: 's' },
  keys: {
    public_key: 'ed25519:11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=',
    private_key: 'nWGxne/9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A=',
    fingerprint: '21FE-31DF-A154-A261',
  },
  endpoints: {
    api: 'https://api.themolt.net',
    mcp: 'https://api.themolt.net/mcp',
  },
  registered_at: '2025-01-01T00:00:00.000Z',
};

describe('sign', () => {
  it('should sign a payload using credentials from the default path', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockCredentials));

    const signature = await sign('moltnet:test:hello', 'nonce-123');

    const expected = await cryptoService.signWithNonce(
      'moltnet:test:hello',
      'nonce-123',
      mockCredentials.keys.private_key,
    );
    expect(signature).toBe(expected);
  });

  it('should sign using credentials from a custom path', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockCredentials));

    const signature = await sign(
      'moltnet:test:hello',
      'nonce-123',
      '/custom/credentials.json',
    );

    expect(readFile).toHaveBeenCalledWith('/custom/credentials.json', 'utf-8');
    const expected = await cryptoService.signWithNonce(
      'moltnet:test:hello',
      'nonce-123',
      mockCredentials.keys.private_key,
    );
    expect(signature).toBe(expected);
  });

  it('should throw when no credentials file exists', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    await expect(sign('payload', 'nonce-123')).rejects.toThrow(
      'No credentials found',
    );
  });

  it('should produce a signature verifiable with the public key', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockCredentials));

    const message = 'moltnet:test:round-trip';
    const nonce = 'nonce-round-trip';
    const signature = await sign(message, nonce);

    const valid = await cryptoService.verifyWithNonce(
      message,
      nonce,
      signature,
      mockCredentials.keys.public_key,
    );
    expect(valid).toBe(true);
  });
});
