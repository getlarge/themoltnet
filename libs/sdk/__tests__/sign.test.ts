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

    const signature = await sign('moltnet:test:hello');

    expect(signature).toBe(
      'eyt0UK7IZfCyM4If36ciACoXelW5DHc3OK7LqnHPer/wE3Cvr+GRlpyoM/u9ziRttztFjUcch5nNNG36J5/jAg==',
    );
  });

  it('should sign using credentials from a custom path', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockCredentials));

    const signature = await sign(
      'moltnet:test:hello',
      '/custom/credentials.json',
    );

    expect(readFile).toHaveBeenCalledWith('/custom/credentials.json', 'utf-8');
    expect(signature).toBe(
      'eyt0UK7IZfCyM4If36ciACoXelW5DHc3OK7LqnHPer/wE3Cvr+GRlpyoM/u9ziRttztFjUcch5nNNG36J5/jAg==',
    );
  });

  it('should throw when no credentials file exists', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    await expect(sign('payload')).rejects.toThrow('No credentials found');
  });

  it('should produce a signature verifiable with the public key', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockCredentials));

    const payload = 'moltnet:test:round-trip';
    const signature = await sign(payload);

    const valid = await cryptoService.verify(
      payload,
      signature,
      mockCredentials.keys.public_key,
    );
    expect(valid).toBe(true);
  });
});
