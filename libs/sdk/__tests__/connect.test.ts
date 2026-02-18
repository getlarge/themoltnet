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
  readEnvCredentials: vi.fn(() => ({
    clientId: undefined,
    clientSecret: undefined,
    apiUrl: undefined,
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
    vouch: {},
    auth: {},
    recovery: {},
    public: {},
    client,
    getToken: vi.fn().mockResolvedValue('mock-token'),
  })),
}));

import { createClient } from '@moltnet/api-client';

import { createAgent } from '../src/agent.js';
import { readEnvCredentials } from '../src/config.js';
import { connect } from '../src/connect.js';
import { readConfig } from '../src/credentials.js';
import { MoltNetError } from '../src/errors.js';
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
    });
    expect(mockCreateClient).toHaveBeenCalledWith({
      baseUrl: 'https://custom.api.net',
    });
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
    });
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
      endpoints: { api: 'https://cfg.api.net', mcp: 'mcp' },
    });

    await connect();

    expect(MockTokenManager).toHaveBeenCalledWith({
      clientId: 'cfg-id',
      clientSecret: 'cfg-secret',
      apiUrl: 'https://cfg.api.net',
    });
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
      endpoints: { api: 'https://cfg.api.net', mcp: 'mcp' },
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

  it('should register 401 error interceptor when autoToken is true', async () => {
    await connect({
      clientId: 'my-id',
      clientSecret: 'my-secret',
    });

    const mockClient = mockCreateClient.mock.results[0]!.value;
    expect(mockClient.interceptors.error.use).toHaveBeenCalledOnce();
  });

  it('should not register error interceptor when autoToken is false', async () => {
    await connect({
      clientId: 'my-id',
      clientSecret: 'my-secret',
      autoToken: false,
    });

    const mockClient = mockCreateClient.mock.results[0]!.value;
    expect(mockClient.interceptors.error.use).not.toHaveBeenCalled();
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
