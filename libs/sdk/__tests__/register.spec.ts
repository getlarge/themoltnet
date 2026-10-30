import { enrollAgent, registerAgent } from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MoltNetError, NetworkError } from '../src/errors.js';
import {
  buildMcpConfig,
  createIdempotencyKey,
  requestRegistration,
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
  agentId: 'agent-123',
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

    const result = await requestRegistration({
      credentialType: 'oauth2',
      apiUrl: 'http://localhost:8000',
    });

    expect(result.identity).toMatchObject({
      subjectId: 'agent-123',
      subjectType: 'agent',
    });
    expect(result.credentials).toEqual(oauthResponse.credential);
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

    const result = await requestRegistration({
      credentialType: 'agent_key',
      enrollmentToken: 'A'.repeat(43),
    });

    expect(result.credentials).toEqual(credential);
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

  it('signs with a prepared keypair instead of generating one', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));

    await requestRegistration({
      credentialType: 'oauth2',
      keyPair: {
        publicKey: 'ed25519:prepared',
        privateKey: 'prepared-seed',
        fingerprint: 'PREP-0000-0000-0000',
      },
    });

    expect(cryptoService.generateKeyPair).not.toHaveBeenCalled();
    expect(cryptoService.sign).toHaveBeenCalledWith(
      expect.stringContaining('ed25519:prepared'),
      'prepared-seed',
    );
  });

  it('uses the default API URL and strips trailing slashes', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    expect(
      (await requestRegistration({ credentialType: 'oauth2' })).apiUrl,
    ).toBe('https://api.themolt.net');
    expect(
      (
        await requestRegistration({
          credentialType: 'oauth2',
          apiUrl: 'http://localhost:8000/',
        })
      ).apiUrl,
    ).toBe('http://localhost:8000');
  });

  it('rejects remote plaintext HTTP before generating or sending credentials', async () => {
    await expect(
      requestRegistration({
        credentialType: 'agent_key',
        enrollmentToken: 'sensitive-enrollment-token',
        apiUrl: 'http://api.example.com',
      }),
    ).rejects.toThrow('Refusing to send credentials to insecure API URL');
    expect(cryptoService.generateKeyPair).not.toHaveBeenCalled();
    expect(enrollAgent).not.toHaveBeenCalled();
    expect(registerAgent).not.toHaveBeenCalled();
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
    await expect(
      requestRegistration({ credentialType: 'oauth2' }),
    ).rejects.toThrow(MoltNetError);

    vi.mocked(registerAgent).mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      requestRegistration({ credentialType: 'oauth2' }),
    ).rejects.toThrow(NetworkError);
  });

  it('replays a dropped response once with the same signed request', async () => {
    vi.mocked(registerAgent)
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(success(oauthResponse));

    await expect(
      requestRegistration({ credentialType: 'oauth2' }),
    ).resolves.toMatchObject({
      identity: { subjectId: 'agent-123', subjectType: 'agent' },
    });
    expect(registerAgent).toHaveBeenCalledTimes(2);
    expect(vi.mocked(registerAgent).mock.calls[1][0]).toEqual(
      vi.mocked(registerAgent).mock.calls[0][0],
    );
  });

  it('forwards registration cancellation to the API request', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const controller = new AbortController();

    await requestRegistration({
      credentialType: 'oauth2',
      signal: controller.signal,
    });

    expect(registerAgent).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('rejects an empty response', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(undefined));
    await expect(
      requestRegistration({ credentialType: 'oauth2' }),
    ).rejects.toThrow(NetworkError);
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
