import { enrollAgent, registerAgent } from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MoltNetError, NetworkError } from '../src/errors.js';
import {
  buildMcpConfig,
  createIdempotencyKey,
  register,
} from '../src/register.js';

vi.mock('@moltnet/crypto-service', () => ({
  cryptoService: {
    generateKeyPair: vi.fn().mockResolvedValue({
      publicKey: 'ed25519:dGVzdHB1YmtleQ==',
      privateKey: 'dGVzdHByaXZrZXk=',
      fingerprint: 'ABCD-1234-EF56-7890',
    }),
    sign: vi.fn().mockResolvedValue('registration-proof'),
  },
}));

vi.mock('@moltnet/api-client', () => ({
  createClient: vi.fn().mockReturnValue({}),
  enrollAgent: vi.fn(),
  registerAgent: vi.fn(),
}));

const oauthResponse = {
  identityId: 'uuid-123',
  fingerprint: 'ABCD-1234-EF56-7890',
  publicKey: 'ed25519:dGVzdHB1YmtleQ==',
  credential: {
    type: 'oauth2' as const,
    clientId: 'client-id',
    clientSecret: 'client-secret',
  },
};

const success = (data: unknown) =>
  ({
    data,
    error: undefined,
    request: new Request('http://localhost'),
    response: new Response(),
  }) as never;

describe('register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('self-registers with an automatic nonce and local proof', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));

    const result = await register({
      credentialType: 'oauth2',
      apiUrl: 'http://localhost:8000',
    });

    expect(result.identity.identityId).toBe('uuid-123');
    expect(result.credentials).toEqual(oauthResponse.credential);
    expect(result.mcpConfig.mcpServers.moltnet.headers).toEqual({
      'X-Client-Id': 'client-id',
      'X-Client-Secret': 'client-secret',
    });
    expect(registerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'idempotency-key': expect.stringMatching(/^[\w-]{43}$/) },
        body: expect.objectContaining({
          credentialType: 'oauth2',
          proof: 'registration-proof',
        }),
      }),
    );
    expect(cryptoService.sign).toHaveBeenCalledWith(
      expect.stringContaining('moltnet:register:self\n'),
      'dGVzdHByaXZrZXk=',
    );
  });

  it('redeems an enrollment token and requests an agent key', async () => {
    const credential = {
      type: 'agent_key' as const,
      key: { id: 'key-1' },
      secret: 'agent-key-secret',
    };
    vi.mocked(enrollAgent).mockResolvedValue(
      success({ ...oauthResponse, credential }),
    );

    const result = await register({
      credentialType: 'agent_key',
      enrollmentToken: 'A'.repeat(43),
    });

    expect(result.credentials).toEqual(credential);
    expect(result.mcpConfig.mcpServers.moltnet.headers).toEqual({
      Authorization: 'Bearer agent-key-secret',
    });
    expect(enrollAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          token: 'A'.repeat(43),
          credentialType: 'agent_key',
        }),
      }),
    );
    expect(cryptoService.sign).toHaveBeenCalledWith(
      expect.stringContaining('moltnet:register:team\n'),
      'dGVzdHByaXZrZXk=',
    );
  });

  it('uses the default API URL and strips trailing slashes', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    expect((await register({ credentialType: 'oauth2' })).apiUrl).toBe(
      'https://api.themolt.net',
    );
    expect(
      (
        await register({
          credentialType: 'oauth2',
          apiUrl: 'http://localhost:8000/',
        })
      ).apiUrl,
    ).toBe('http://localhost:8000');
  });

  it('maps API errors and transport failures', async () => {
    vi.mocked(registerAgent).mockResolvedValue({
      data: undefined,
      error: {
        type: 'urn:moltnet:problem:registration-failed',
        title: 'Registration failed',
        status: 403,
      },
    } as never);
    await expect(register({ credentialType: 'oauth2' })).rejects.toThrow(
      MoltNetError,
    );

    vi.mocked(registerAgent).mockRejectedValue(new TypeError('fetch failed'));
    await expect(register({ credentialType: 'oauth2' })).rejects.toThrow(
      NetworkError,
    );
  });

  it('replays a dropped response once with the same signed request', async () => {
    vi.mocked(registerAgent)
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(success(oauthResponse));

    await expect(register({ credentialType: 'oauth2' })).resolves.toMatchObject(
      { identity: { identityId: 'uuid-123' } },
    );
    expect(registerAgent).toHaveBeenCalledTimes(2);
    expect(vi.mocked(registerAgent).mock.calls[1][0]).toEqual(
      vi.mocked(registerAgent).mock.calls[0][0],
    );
  });

  it('rejects an empty response', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(undefined));
    await expect(register({ credentialType: 'oauth2' })).rejects.toThrow(
      NetworkError,
    );
  });
});

describe('registration helpers', () => {
  it('creates 32-byte base64url idempotency keys', () => {
    expect(createIdempotencyKey()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('builds OAuth2 and agent-key MCP headers', () => {
    expect(
      buildMcpConfig('https://api.themolt.net/', {
        type: 'oauth2',
        clientId: 'id',
        clientSecret: 'secret',
      }).mcpServers.moltnet,
    ).toMatchObject({
      url: 'https://mcp.themolt.net/mcp',
      headers: { 'X-Client-Id': 'id', 'X-Client-Secret': 'secret' },
    });
    expect(
      buildMcpConfig('https://api.themolt.net', {
        type: 'agent_key',
        secret: 'secret',
      }).mcpServers.moltnet.headers,
    ).toEqual({ Authorization: 'Bearer secret' });
  });
});
