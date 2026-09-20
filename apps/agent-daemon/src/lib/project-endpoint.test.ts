import type * as Sdk from '@themoltnet/sdk';
import { beforeEach, expect, it, vi } from 'vitest';

import { resolveAgentContext } from './agent-context.js';

const mocks = vi.hoisted(() => ({
  readConfig: vi.fn(),
  resolveAgentKey: vi.fn(),
  connect: vi.fn(),
}));
vi.mock('@themoltnet/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  readConfig: mocks.readConfig,
  resolveAgentKey: mocks.resolveAgentKey,
  getIdentityDir: () => '/central/identities/test',
}));
vi.mock('@themoltnet/sdk/node', () => ({
  connect: mocks.connect,
  createNodeSecretProviderRegistry: () => ({}),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readConfig.mockResolvedValue({
    agent_key_ref: { provider: 'memory', key: 'agent-key/test' },
    endpoints: { api: 'https://selfhost.example/api' },
  });
  mocks.resolveAgentKey.mockResolvedValue('ak_test');
  mocks.connect.mockResolvedValue({});
});

it('connects a binding matching the selected self-hosted identity endpoint', async () => {
  await resolveAgentContext('test', {
    projectApiUrl: 'https://selfhost.example/api/',
  });
  expect(mocks.connect).toHaveBeenCalledWith(
    expect.objectContaining({ apiUrl: 'https://selfhost.example/api/' }),
  );
});

it.each([
  'https://api.themolt.net',
  'https://another.example/api',
  'http://selfhost.example/api',
])(
  'rejects mismatched or insecure binding %s before resolving credentials',
  async (projectApiUrl) => {
    await expect(
      resolveAgentContext('test', { projectApiUrl }),
    ).rejects.toThrow();
    expect(mocks.resolveAgentKey).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  },
);

it('allows an explicit environment endpoint matching the binding', async () => {
  await resolveAgentContext('test', {
    projectApiUrl: 'https://override.example',
    envApiUrl: 'https://override.example/',
  });
  expect(mocks.connect).toHaveBeenCalledWith(
    expect.objectContaining({ apiUrl: 'https://override.example' }),
  );
});

it('requires configless bindings to match the explicit endpoint or hosted default', async () => {
  await expect(
    resolveAgentContext('test', {
      credentialSource: 'environment',
      projectApiUrl: 'https://selfhost.example',
    }),
  ).rejects.toThrow();
  expect(mocks.connect).not.toHaveBeenCalled();
  await resolveAgentContext('test', {
    credentialSource: 'environment',
    projectApiUrl: 'https://selfhost.example',
    envApiUrl: 'https://selfhost.example/',
  });
  expect(mocks.readConfig).not.toHaveBeenCalled();
  expect(mocks.connect).toHaveBeenCalledWith(
    expect.objectContaining({ apiUrl: 'https://selfhost.example' }),
  );
});

it('rejects a mismatched explicit endpoint before resolving a key', async () => {
  await expect(
    resolveAgentContext('test', {
      projectApiUrl: 'https://selfhost.example/api',
      envApiUrl: 'https://override.example',
    }),
  ).rejects.toThrow();
  expect(mocks.resolveAgentKey).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
});

it('rejects insecure identity transport before resolving a key even without a binding', async () => {
  mocks.readConfig.mockResolvedValue({
    agent_key_ref: { provider: 'memory', key: 'agent-key/test' },
    endpoints: { api: 'http://selfhost.example/api' },
  });
  await expect(resolveAgentContext('test')).rejects.toThrow();
  expect(mocks.resolveAgentKey).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
});
