import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetToken, mockInvalidate } = vi.hoisted(() => ({
  mockGetToken: vi.fn().mockResolvedValue('mock-token'),
  mockInvalidate: vi.fn(),
}));

vi.mock('@moltnet/api-client', () => ({
  createClient: vi.fn(() => ({
    interceptors: {
      error: { use: vi.fn() },
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  })),
}));

vi.mock('../src/config.js', () => ({
  readEnvironmentVariable: vi.fn(() => undefined),
  readEnvCredentials: vi.fn(() => ({
    clientId: undefined,
    clientSecret: undefined,
    apiUrl: undefined,
    agentKey: undefined,
    credentialsPath: undefined,
  })),
}));

vi.mock('../src/credentials.js', () => ({
  readConfig: vi.fn(),
}));

vi.mock('../src/token.js', () => {
  const TM = vi.fn();
  TM.prototype.getToken = mockGetToken;
  TM.prototype.invalidate = mockInvalidate;
  return { TokenManager: TM };
});

vi.mock('../src/agent.js', () => ({
  createAgent: vi.fn(({ client }) => ({
    diary: {},
    agents: {},
    crypto: {},
    agentEnrollments: {},
    auth: {},
    recovery: {},
    public: {},
    client,
    getToken: vi.fn().mockResolvedValue('mock-token'),
  })),
}));

import { createClient } from '@moltnet/api-client';
import { CREDENTIAL_SCOPES } from '@moltnet/models';

import { createAgent } from '../src/agent.js';
import { readEnvCredentials } from '../src/config.js';
import { connect } from '../src/connect.js';
import { readConfig } from '../src/credentials.js';
import { MoltNetError } from '../src/errors.js';
import {
  READ_ONLY_CAPABILITIES,
  SecretProviderRegistry,
} from '../src/secrets.js';
import { TokenManager } from '../src/token.js';

const mockCreateClient = vi.mocked(createClient);
const mockReadConfig = vi.mocked(readConfig);
const mockReadEnvCredentials = vi.mocked(readEnvCredentials);
const MockTokenManager = vi.mocked(TokenManager);
const mockCreateAgent = vi.mocked(createAgent);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset env mock to return nothing by default
  mockReadEnvCredentials.mockReturnValue({
    clientId: undefined,
    clientSecret: undefined,
    apiUrl: undefined,
    agentKey: undefined,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('connect', () => {
  it('should connect with explicit credentials', async () => {
    const agent = await connect({
      clientId: 'my-id',
      clientSecret: 'my-secret',
      apiUrl: 'https://custom.api.net',
    });

    expect(MockTokenManager).toHaveBeenCalledWith({
      clientId: 'my-id',
      clientSecret: 'my-secret',
      apiUrl: 'https://custom.api.net',
      scopes: undefined,
    });
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://custom.api.net' }),
    );
    expect(mockCreateAgent).toHaveBeenCalledOnce();
    expect(agent).toBeDefined();
  });

  it('should connect with environment variables', async () => {
    mockReadEnvCredentials.mockReturnValue({
      clientId: 'env-id',
      clientSecret: 'env-secret',
      apiUrl: 'https://env.api.net',
    });

    await connect();

    expect(MockTokenManager).toHaveBeenCalledWith({
      clientId: 'env-id',
      clientSecret: 'env-secret',
      apiUrl: 'https://env.api.net',
      scopes: undefined,
    });
  });

  it('rejects a config directory outside the identity activated by moltnet start', async () => {
    mockReadEnvCredentials.mockReturnValue({
      clientId: 'env-id',
      clientSecret: 'env-secret',
      credentialsPath: '/repo/.moltnet/active/moltnet.json',
    });

    await expect(
      connect({ configDir: '/repo/.moltnet/another' }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(MockTokenManager).not.toHaveBeenCalled();
  });

  it('should connect with config file', async () => {
    mockReadConfig.mockResolvedValueOnce({
      identity_id: 'id-1',
      registered_at: '2024-01-01',
      oauth2: { client_id: 'cfg-id', client_secret: 'cfg-secret' },
      keys: {
        public_key: 'pk',
        private_key: 'sk',
        fingerprint: 'fp',
      },
      endpoints: { api: 'https://api.themolt.net', mcp: 'mcp' },
    });

    await connect();

    expect(MockTokenManager).toHaveBeenCalledWith({
      clientId: 'cfg-id',
      clientSecret: 'cfg-secret',
      apiUrl: 'https://api.themolt.net',
      scopes: undefined,
    });
  });

  it('resolves a config secret reference only when connecting', async () => {
    mockReadConfig.mockResolvedValueOnce({
      identity_id: 'id-1',
      registered_at: '2024-01-01',
      oauth2: {
        client_id: 'cfg-id',
        client_secret_ref: {
          provider: 'memory',
          key: 'oauth2/id-1/cfg-id',
        },
      },
      keys: { public_key: 'pk', private_key: 'sk', fingerprint: 'fp' },
      endpoints: { api: 'https://api.themolt.net', mcp: 'mcp' },
    });
    const secretProviders = new SecretProviderRegistry().register({
      name: 'memory',
      capabilities: READ_ONLY_CAPABILITIES,
      read: async () => 'resolved-secret',
      probe: async () => 'present',
    });

    await connect({ secretProviders });

    expect(MockTokenManager).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'cfg-id',
        clientSecret: 'resolved-secret',
      }),
    );
  });

  it('never resolves an arbitrary config-selected secret for an arbitrary origin', async () => {
    mockReadConfig.mockResolvedValueOnce({
      identity_id: 'id-1',
      registered_at: '2024-01-01',
      oauth2: {
        client_id: 'cfg-id',
        client_secret_ref: { provider: 'memory', key: 'unrelated-secret' },
      },
      keys: { public_key: 'pk', private_key: 'sk', fingerprint: 'fp' },
      endpoints: { api: 'https://attacker.example', mcp: 'mcp' },
    });
    const read = vi.fn().mockResolvedValue('canary-secret');
    const secretProviders = new SecretProviderRegistry().register({
      name: 'memory',
      capabilities: READ_ONLY_CAPABILITIES,
      read,
      probe: async () => 'present',
    });

    await expect(connect({ secretProviders })).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
    });
    expect(read).not.toHaveBeenCalled();
    expect(MockTokenManager).not.toHaveBeenCalled();
  });

  it('rejects config that contains plaintext and a secret reference', async () => {
    mockReadConfig.mockResolvedValueOnce({
      identity_id: 'id-1',
      registered_at: '2024-01-01',
      oauth2: {
        client_id: 'cfg-id',
        client_secret: 'plaintext',
        client_secret_ref: { provider: 'memory', key: 'oauth' },
      },
      keys: { public_key: 'pk', private_key: 'sk', fingerprint: 'fp' },
      endpoints: { api: 'https://api.themolt.net', mcp: 'mcp' },
    } as never);

    await expect(connect()).rejects.toThrow(/exactly one/);
  });

  it('passes an explicit OAuth2 scope subset to the token manager', async () => {
    const scopes = [
      CREDENTIAL_SCOPES.DiaryRead,
      CREDENTIAL_SCOPES.DiaryWrite,
    ] as const;

    await connect({
      clientId: 'my-id',
      clientSecret: 'my-secret',
      scopes,
    });

    expect(MockTokenManager).toHaveBeenCalledWith(
      expect.objectContaining({ scopes }),
    );
  });

  it('should respect precedence: explicit > env > config', async () => {
    mockReadEnvCredentials.mockReturnValue({
      clientId: 'env-id',
      clientSecret: 'env-secret',
      apiUrl: undefined,
    });
    mockReadConfig.mockResolvedValueOnce({
      identity_id: 'id-1',
      registered_at: '2024-01-01',
      oauth2: { client_id: 'cfg-id', client_secret: 'cfg-secret' },
      keys: {
        public_key: 'pk',
        private_key: 'sk',
        fingerprint: 'fp',
      },
      endpoints: { api: 'https://api.themolt.net', mcp: 'mcp' },
    });

    await connect({
      clientId: 'explicit-id',
      clientSecret: 'explicit-secret',
    });

    expect(MockTokenManager).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'explicit-id',
        clientSecret: 'explicit-secret',
      }),
    );
  });

  it('should throw MoltNetError when no credentials are found', async () => {
    mockReadConfig.mockResolvedValueOnce(null);

    await expect(connect()).rejects.toThrow(MoltNetError);
    await expect(connect()).rejects.toThrow(/No credentials found/);
  });

  it('should use default API URL when none provided', async () => {
    await connect({
      clientId: 'my-id',
      clientSecret: 'my-secret',
    });

    expect(MockTokenManager).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: 'https://api.themolt.net',
      }),
    );
  });

  it('should strip trailing slash from API URL', async () => {
    await connect({
      clientId: 'my-id',
      clientSecret: 'my-secret',
      apiUrl: 'https://api.themolt.net/',
    });

    expect(MockTokenManager).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: 'https://api.themolt.net',
      }),
    );
  });

  it('should pass retry fetch when autoToken is true', async () => {
    await connect({
      clientId: 'my-id',
      clientSecret: 'my-secret',
    });

    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        fetch: expect.any(Function),
      }),
    );
  });

  it('should not pass retry fetch when autoToken is false', async () => {
    await connect({
      clientId: 'my-id',
      clientSecret: 'my-secret',
      autoToken: false,
    });

    expect(mockCreateClient).toHaveBeenCalledWith({
      baseUrl: 'https://api.themolt.net',
    });
  });

  it('should pass invalidate-on-401 fetch when retry is false but autoToken is true', async () => {
    await connect({
      clientId: 'my-id',
      clientSecret: 'my-secret',
      retry: false,
    });

    // Even without retry, a custom fetch is passed to invalidate stale tokens
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        fetch: expect.any(Function),
      }),
    );
  });

  it('should pass auth callback and tokenManager to createAgent', async () => {
    await connect({
      clientId: 'my-id',
      clientSecret: 'my-secret',
    });

    const agentOpts = mockCreateAgent.mock.calls[0]![0];
    expect(agentOpts.tokenManager).toBeDefined();
    expect(agentOpts.auth).toBeTypeOf('function');
    expect(agentOpts.client).toBeDefined();
  });

  it('should not pass auth callback when autoToken is false', async () => {
    await connect({
      clientId: 'my-id',
      clientSecret: 'my-secret',
      autoToken: false,
    });

    const agentOpts = mockCreateAgent.mock.calls[0]![0];
    expect(agentOpts.auth).toBeUndefined();
  });
});

describe('connect (agent-key mode)', () => {
  it('uses a static bearer and skips TokenManager when agentKey option is set', async () => {
    await connect({ agentKey: 'opaque-key', apiUrl: 'https://custom.api.net' });

    expect(MockTokenManager).not.toHaveBeenCalled();
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://custom.api.net' }),
    );
    const agentOpts = mockCreateAgent.mock.calls[0]![0];
    expect(agentOpts.tokenManager).toBeUndefined();
    expect(agentOpts.auth).toBeTypeOf('function');
    await expect(agentOpts.auth!()).resolves.toBe('opaque-key');
  });

  it('reads MOLTNET_AGENT_KEY from env', async () => {
    mockReadEnvCredentials.mockReturnValue({
      clientId: undefined,
      clientSecret: undefined,
      apiUrl: 'https://agent-key.example.test',
      agentKey: 'env-key',
    });

    await connect();

    expect(MockTokenManager).not.toHaveBeenCalled();
    const agentOpts = mockCreateAgent.mock.calls[0]![0];
    await expect(agentOpts.auth!()).resolves.toBe('env-key');
  });

  it('prefers the explicit agentKey option over the env var', async () => {
    mockReadEnvCredentials.mockReturnValue({
      clientId: undefined,
      clientSecret: undefined,
      apiUrl: 'https://agent-key.example.test',
      agentKey: 'env-key',
    });

    await connect({ agentKey: 'option-key' });

    const agentOpts = mockCreateAgent.mock.calls[0]![0];
    await expect(agentOpts.auth!()).resolves.toBe('option-key');
  });

  it('lets explicit OAuth2 options win over an ambient MOLTNET_AGENT_KEY', async () => {
    mockReadEnvCredentials.mockReturnValue({
      clientId: undefined,
      clientSecret: undefined,
      apiUrl: undefined,
      agentKey: 'ambient-key',
    });

    await connect({ clientId: 'explicit-id', clientSecret: 'explicit-secret' });

    // Explicit in-code credentials must beat a stray env key: OAuth2 wins.
    expect(MockTokenManager).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'explicit-id',
        clientSecret: 'explicit-secret',
      }),
    );
    const agentOpts = mockCreateAgent.mock.calls[0]![0];
    expect(agentOpts.tokenManager).toBeDefined();
  });

  it('ignores a whitespace-only agent key', async () => {
    mockReadConfig.mockResolvedValueOnce(null);
    await expect(connect({ agentKey: '   ' })).rejects.toThrow(
      /No credentials found/,
    );
  });

  it('does not read config in key mode', async () => {
    mockReadEnvCredentials.mockReturnValue({
      clientId: undefined,
      clientSecret: undefined,
      apiUrl: 'https://agent-key.example.test',
      agentKey: undefined,
    });

    await connect({ agentKey: 'k' });

    expect(mockReadConfig).not.toHaveBeenCalled();
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://agent-key.example.test' }),
    );
  });

  it('fails closed without an explicit agent-key API endpoint', async () => {
    await expect(connect({ agentKey: 'k' })).rejects.toThrow(
      'Set apiUrl or MOLTNET_API_URL',
    );

    expect(mockReadConfig).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

describe('connect (agent-key references)', () => {
  function memoryRegistry(values: Record<string, string>) {
    return new SecretProviderRegistry().register({
      name: 'memory',
      capabilities: READ_ONLY_CAPABILITIES,
      read: async (key) => values[key] ?? null,
      probe: async (key) => (key in values ? 'present' : 'absent'),
    });
  }

  it('resolves MOLTNET_AGENT_KEY_REF into a static bearer without reading config', async () => {
    mockReadEnvCredentials.mockReturnValue({
      apiUrl: 'https://agent-key.example.test',
      agentKeyRef: 'memory:runtime/agent-key',
    });

    await connect({
      secretProviders: memoryRegistry({ 'runtime/agent-key': 'ak_from_ref' }),
    });

    expect(mockReadConfig).not.toHaveBeenCalled();
    expect(MockTokenManager).not.toHaveBeenCalled();
    const agentOpts = mockCreateAgent.mock.calls[0]![0];
    await expect(agentOpts.auth!()).resolves.toBe('ak_from_ref');
  });

  it('rejects MOLTNET_AGENT_KEY together with MOLTNET_AGENT_KEY_REF', async () => {
    mockReadEnvCredentials.mockReturnValue({
      apiUrl: 'https://agent-key.example.test',
      agentKey: 'ak_value',
      agentKeyRef: 'memory:runtime/agent-key',
    });

    await expect(connect()).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(mockReadConfig).not.toHaveBeenCalled();
  });

  it('surfaces an unresolvable env reference as NO_CREDENTIALS', async () => {
    mockReadEnvCredentials.mockReturnValue({
      apiUrl: 'https://agent-key.example.test',
      agentKeyRef: 'memory:runtime/missing',
    });

    await expect(
      connect({ secretProviders: memoryRegistry({}) }),
    ).rejects.toMatchObject({ code: 'NO_CREDENTIALS' });
  });

  it('prefers a config agent_key_ref over OAuth2 and trusts the config endpoint', async () => {
    mockReadConfig.mockResolvedValueOnce({
      identity_id: 'id-1',
      registered_at: '2024-01-01',
      agent_key_ref: { provider: 'memory', key: 'agent-key/id-1' },
      oauth2: { client_id: 'cfg-id', client_secret: 'cfg-secret' },
      keys: { public_key: 'pk', private_key: 'sk', fingerprint: 'fp' },
      endpoints: { api: 'https://api.themolt.net', mcp: 'mcp' },
    });

    await connect({
      secretProviders: memoryRegistry({ 'agent-key/id-1': 'ak_cfg' }),
    });

    expect(MockTokenManager).not.toHaveBeenCalled();
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://api.themolt.net' }),
    );
    const agentOpts = mockCreateAgent.mock.calls[0]![0];
    await expect(agentOpts.auth!()).resolves.toBe('ak_cfg');
  });

  it('rejects a config agent_key_ref bound to another identity', async () => {
    mockReadConfig.mockResolvedValueOnce({
      identity_id: 'id-1',
      registered_at: '2024-01-01',
      agent_key_ref: { provider: 'memory', key: 'agent-key/other' },
      oauth2: { client_id: 'cfg-id', client_secret: 'cfg-secret' },
      keys: { public_key: 'pk', private_key: 'sk', fingerprint: 'fp' },
      endpoints: { api: 'https://api.themolt.net', mcp: 'mcp' },
    });

    await expect(
      connect({ secretProviders: memoryRegistry({ 'agent-key/other': 'x' }) }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(MockTokenManager).not.toHaveBeenCalled();
  });

  it('refuses to send any agent key over remote plaintext HTTP', async () => {
    await expect(
      connect({ agentKey: 'k', apiUrl: 'http://remote.example.test' }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });

    mockReadEnvCredentials.mockReturnValue({
      apiUrl: 'http://remote.example.test',
      agentKeyRef: 'memory:runtime/agent-key',
    });
    await expect(
      connect({
        secretProviders: memoryRegistry({ 'runtime/agent-key': 'ak' }),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });

    mockReadEnvCredentials.mockReturnValue({
      apiUrl: 'http://remote.example.test',
    });
    mockReadConfig.mockResolvedValueOnce({
      identity_id: 'id-1',
      registered_at: '2024-01-01',
      agent_key_ref: { provider: 'memory', key: 'agent-key/id-1' },
      oauth2: { client_id: 'cfg-id', client_secret: 'cfg-secret' },
      keys: { public_key: 'pk', private_key: 'sk', fingerprint: 'fp' },
      endpoints: { api: 'https://api.themolt.net', mcp: 'mcp' },
    });
    await expect(
      connect({ secretProviders: memoryRegistry({ 'agent-key/id-1': 'ak' }) }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('allows plaintext HTTP to loopback for local stacks', async () => {
    await connect({ agentKey: 'k', apiUrl: 'http://127.0.0.1:3000' });
    await connect({ agentKey: 'k', apiUrl: 'http://localhost:3000' });
    expect(mockCreateClient).toHaveBeenCalledTimes(2);
  });

  it('rejects a config agent_key_ref that names the env provider', async () => {
    mockReadConfig.mockResolvedValueOnce({
      identity_id: 'id-1',
      registered_at: '2024-01-01',
      agent_key_ref: { provider: 'env', key: 'MOLTNET_AGENT_KEY' },
      oauth2: { client_id: 'cfg-id', client_secret: 'cfg-secret' },
      keys: { public_key: 'pk', private_key: 'sk', fingerprint: 'fp' },
      endpoints: { api: 'https://api.themolt.net', mcp: 'mcp' },
    });

    await expect(connect()).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});
