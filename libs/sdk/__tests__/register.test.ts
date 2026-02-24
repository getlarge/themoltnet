import { describe, expect, it, vi } from 'vitest';

import { MoltNetError, NetworkError } from '../src/errors.js';
import { buildMcpConfig, register } from '../src/register.js';

vi.mock('@moltnet/crypto-service', () => ({
  cryptoService: {
    generateKeyPair: vi.fn().mockResolvedValue({
      publicKey: 'ed25519:dGVzdHB1YmtleQ==',
      privateKey: 'dGVzdHByaXZrZXk=',
      fingerprint: 'ABCD-1234-EF56-7890',
    }),
  },
}));

vi.mock('@moltnet/api-client', () => ({
  createClient: vi.fn().mockReturnValue({}),
  registerAgent: vi.fn(),
}));

describe('register', () => {
  it('should return identity, credentials, and mcpConfig on success', async () => {
    const { registerAgent } = await import('@moltnet/api-client');
    vi.mocked(registerAgent).mockResolvedValue({
      data: {
        identityId: 'uuid-123',
        fingerprint: 'ABCD-1234-EF56-7890',
        publicKey: 'ed25519:dGVzdHB1YmtleQ==',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
      error: undefined,
      request: new Request('http://localhost'),
      response: new Response(),
    } as never);

    const result = await register({
      voucherCode: 'test-voucher',
      apiUrl: 'http://localhost:8000',
    });

    expect(result.identity.publicKey).toBe('ed25519:dGVzdHB1YmtleQ==');
    expect(result.identity.privateKey).toBe('dGVzdHByaXZrZXk=');
    expect(result.identity.fingerprint).toBe('ABCD-1234-EF56-7890');
    expect(result.identity.identityId).toBe('uuid-123');
    expect(result.credentials.clientId).toBe('client-id');
    expect(result.credentials.clientSecret).toBe('client-secret');
    expect(result.mcpConfig.mcpServers.moltnet.url).toBe(
      'http://localhost:8000/mcp',
    );
    expect(result.apiUrl).toBe('http://localhost:8000');
  });

  it('should use default API URL when not provided', async () => {
    const { registerAgent } = await import('@moltnet/api-client');
    vi.mocked(registerAgent).mockResolvedValue({
      data: {
        identityId: 'id',
        fingerprint: 'ABCD-1234-EF56-7890',
        publicKey: 'ed25519:dGVzdHB1YmtleQ==',
        clientId: 'c',
        clientSecret: 's',
      },
      error: undefined,
      request: new Request('http://localhost'),
      response: new Response(),
    } as never);

    const result = await register({ voucherCode: 'v' });
    expect(result.apiUrl).toBe('https://api.themolt.net');
    expect(result.mcpConfig.mcpServers.moltnet.url).toBe(
      'https://mcp.themolt.net/mcp',
    );
  });

  it('should strip trailing slash from API URL', async () => {
    const { registerAgent } = await import('@moltnet/api-client');
    vi.mocked(registerAgent).mockResolvedValue({
      data: {
        identityId: 'id',
        fingerprint: 'F',
        publicKey: 'ed25519:x',
        clientId: 'c',
        clientSecret: 's',
      },
      error: undefined,
      request: new Request('http://localhost'),
      response: new Response(),
    } as never);

    const result = await register({
      voucherCode: 'v',
      apiUrl: 'http://localhost:8000/',
    });
    expect(result.apiUrl).toBe('http://localhost:8000');
  });

  it('should throw RegistrationError on API error response', async () => {
    const { registerAgent } = await import('@moltnet/api-client');
    vi.mocked(registerAgent).mockResolvedValue({
      data: undefined,
      error: {
        type: 'urn:moltnet:problem:voucher-invalid',
        title: 'Invalid voucher',
        status: 403,
        detail: 'Already redeemed',
      },
      request: new Request('http://localhost'),
      response: new Response(),
    } as never);

    await expect(
      register({ voucherCode: 'bad', apiUrl: 'http://localhost:8000' }),
    ).rejects.toThrow(MoltNetError);
  });

  it('should throw NetworkError on fetch failure', async () => {
    const { registerAgent } = await import('@moltnet/api-client');
    vi.mocked(registerAgent).mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      register({ voucherCode: 'v', apiUrl: 'http://localhost:8000' }),
    ).rejects.toThrow(NetworkError);
  });

  it('should throw NetworkError on empty response', async () => {
    const { registerAgent } = await import('@moltnet/api-client');
    vi.mocked(registerAgent).mockResolvedValue({
      data: undefined,
      error: undefined,
      request: new Request('http://localhost'),
      response: new Response(),
    } as never);

    await expect(
      register({ voucherCode: 'v', apiUrl: 'http://localhost:8000' }),
    ).rejects.toThrow(NetworkError);
  });
});

describe('buildMcpConfig', () => {
  const creds = { clientId: 'test-id', clientSecret: 'test-secret' };

  it('should build MCP config with http type and auth headers', () => {
    const config = buildMcpConfig('https://api.themolt.net', creds);
    expect(config).toEqual({
      mcpServers: {
        moltnet: {
          type: 'http',
          url: 'https://mcp.themolt.net/mcp',
          headers: {
            'X-Client-Id': 'test-id',
            'X-Client-Secret': 'test-secret',
          },
        },
      },
    });
  });

  it('should strip trailing slash', () => {
    const config = buildMcpConfig('https://api.themolt.net/', creds);
    expect(config.mcpServers.moltnet.url).toBe('https://mcp.themolt.net/mcp');
  });
});
