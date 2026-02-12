import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getConfigDir,
  getCredentialsPath,
  readCredentials,
  writeCredentials,
} from '../src/credentials.js';
import type { RegisterResult } from '../src/register.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  chmod: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const mockResult: RegisterResult = {
  identity: {
    publicKey: 'ed25519:dGVzdA==',
    privateKey: 'cHJpdmF0ZQ==',
    fingerprint: 'ABCD-1234-EF56-7890',
    identityId: 'uuid-123',
  },
  credentials: {
    clientId: 'client-id',
    clientSecret: 'client-secret',
  },
  mcpConfig: {
    mcpServers: {
      moltnet: { url: 'https://api.themolt.net/mcp', transport: 'sse' },
    },
  },
  apiUrl: 'https://api.themolt.net',
};

describe('getConfigDir', () => {
  it('should return ~/.config/moltnet', () => {
    expect(getConfigDir()).toBe(join(homedir(), '.config', 'moltnet'));
  });
});

describe('getCredentialsPath', () => {
  it('should return ~/.config/moltnet/credentials.json', () => {
    expect(getCredentialsPath()).toBe(
      join(homedir(), '.config', 'moltnet', 'credentials.json'),
    );
  });
});

describe('writeCredentials', () => {
  it('should create directory and write credentials file', async () => {
    const path = await writeCredentials(mockResult);

    expect(mkdir).toHaveBeenCalledWith(getConfigDir(), { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      getCredentialsPath(),
      expect.stringContaining('"identity_id": "uuid-123"'),
      { mode: 0o600 },
    );
    expect(chmod).toHaveBeenCalledWith(getCredentialsPath(), 0o600);
    expect(path).toBe(getCredentialsPath());
  });

  it('should include all required fields in the output', async () => {
    await writeCredentials(mockResult);

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);

    expect(parsed.identity_id).toBe('uuid-123');
    expect(parsed.oauth2.client_id).toBe('client-id');
    expect(parsed.oauth2.client_secret).toBe('client-secret');
    expect(parsed.keys.public_key).toBe('ed25519:dGVzdA==');
    expect(parsed.keys.private_key).toBe('cHJpdmF0ZQ==');
    expect(parsed.keys.fingerprint).toBe('ABCD-1234-EF56-7890');
    expect(parsed.endpoints.api).toBe('https://api.themolt.net');
    expect(parsed.endpoints.mcp).toBe('https://api.themolt.net/mcp');
    expect(parsed.registered_at).toBeDefined();
  });
});

describe('readCredentials', () => {
  it('should return parsed credentials when file exists', async () => {
    const mockCreds = {
      identity_id: 'uuid-123',
      oauth2: { client_id: 'c', client_secret: 's' },
      keys: {
        public_key: 'ed25519:x',
        private_key: 'y',
        fingerprint: 'A-B-C-D',
      },
      endpoints: {
        api: 'https://api.themolt.net',
        mcp: 'https://api.themolt.net/mcp',
      },
      registered_at: '2025-01-01T00:00:00.000Z',
    };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockCreds));

    const result = await readCredentials();
    expect(result).toEqual(mockCreds);
  });

  it('should return null when file does not exist', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file'));

    const result = await readCredentials();
    expect(result).toBeNull();
  });
});
