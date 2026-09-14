import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type * as ApiClient from '@moltnet/api-client';
import { enrollAgent, registerAgent } from '@moltnet/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getIdentityDir } from '../src/credentials.js';
import {
  MoltNetError,
  NetworkError,
  RegisterIdentityError,
} from '../src/errors.js';
import { OSKeyringSecretProvider, register } from '../src/node.js';
import {
  agentKeyKey,
  identitySeedKey,
  oauth2SecretKey,
  READ_WRITE_CAPABILITIES,
  type SecretProvider,
} from '../src/secrets.js';

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

vi.mock('@moltnet/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
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
const agentKeyResponse = {
  ...oauthResponse,
  credential: {
    type: 'agent_key' as const,
    key: { id: 'key-1' },
    secret: 'agent-key-secret',
  },
};
const whoami = {
  subjectId: 'agent-123',
  subjectType: 'agent' as const,
  identityId: 'uuid-123',
  publicKey: 'ed25519:dGVzdHB1YmtleQ==',
  fingerprint: 'ABCD-1234-EF56-7890',
};
const success = (data: unknown) =>
  ({
    data,
    error: undefined,
    request: new Request('http://localhost'),
    response: new Response(),
  }) as never;

const roots: string[] = [];
async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sdk-register-'));
  roots.push(root);
  return root;
}

function fakeConnect(
  overrides: { whoami?: unknown; updateWhoami?: unknown } = {},
) {
  const whoamiFn = vi.fn().mockResolvedValue(overrides.whoami ?? whoami);
  const updateWhoamiFn = vi.fn().mockResolvedValue(
    overrides.updateWhoami ?? {
      subjectId: 'agent-123',
      fingerprint: whoami.fingerprint,
      alias: 'reg-test',
    },
  );
  const connectAgent = vi.fn().mockResolvedValue({
    agents: {
      whoami: whoamiFn,
      updateWhoami: updateWhoamiFn,
      lookup: vi.fn(),
      verifySignature: vi.fn(),
    },
  });
  return { connectAgent, whoamiFn, updateWhoamiFn };
}

function memoryProvider(
  failOn?: (key: string) => boolean,
): SecretProvider & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    name: 'memory',
    capabilities: READ_WRITE_CAPABILITIES,
    values,
    read: (key) => Promise.resolve(values.get(key) ?? null),
    write: (key, value) => {
      if (failOn?.(key)) {
        return Promise.reject(new Error('simulated store failure'));
      }
      values.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    probe: (key) => Promise.resolve(values.has(key) ? 'present' : 'absent'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('register (node)', () => {
  it('stores the seed and OAuth2 secret as references and writes the canonical config', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    const configDir = join(root, 'identities', 'reg-test');
    const provider = memoryProvider();
    const { connectAgent, updateWhoamiFn } = fakeConnect();

    const result = await register({
      name: 'reg-test',
      apiUrl: 'https://api.example.test',
      secretProvider: provider,
      configDir,
      connectAgent,
    });

    expect(result.configPath).toBe(join(configDir, 'moltnet.json'));
    expect(result.config).toEqual({
      subject_id: 'agent-123',
      subject_type: 'agent',
      registered_at: result.config.registered_at,
      oauth2: {
        client_id: 'client-id',
        client_secret_ref: {
          provider: 'memory',
          key: oauth2SecretKey('agent-123', 'client-id'),
        },
      },
      keys: {
        public_key: 'ed25519:dGVzdHB1YmtleQ==',
        fingerprint: 'ABCD-1234-EF56-7890',
        private_key_ref: {
          provider: 'memory',
          key: identitySeedKey('ABCD-1234-EF56-7890'),
        },
      },
      endpoints: {
        api: 'https://api.example.test',
        mcp: 'https://mcp.example.test/mcp',
      },
    });
    const raw = await readFile(result.configPath, 'utf-8');
    expect(raw).not.toContain('client-secret');
    expect(raw).not.toContain('dGVzdHByaXZrZXk=');
    expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
      'dGVzdHByaXZrZXk=',
    );
    expect(provider.values.get(oauth2SecretKey('agent-123', 'client-id'))).toBe(
      'client-secret',
    );
    expect(
      JSON.parse(await readFile(join(root, 'identity-selector.json'), 'utf-8')),
    ).toEqual({ version: 1, default_identity: 'reg-test' });
    expect(connectAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        apiUrl: 'https://api.example.test',
      }),
    );
    expect(updateWhoamiFn).toHaveBeenCalledWith(
      { alias: 'reg-test' },
      expect.anything(),
    );
    expect(result.aliasPublished).toBe(true);
    expect(result.whoami).toEqual(whoami);
  });

  it('enrolls with an agent key, stores it, and skips alias publication', async () => {
    vi.mocked(enrollAgent).mockResolvedValue(success(agentKeyResponse));
    const root = await freshRoot();
    const provider = memoryProvider();
    const { connectAgent, updateWhoamiFn } = fakeConnect();

    const result = await register({
      name: 'managed',
      apiUrl: 'https://api.example.test',
      credentialType: 'agent_key',
      enrollmentToken: 'A'.repeat(43),
      secretProvider: provider,
      configDir: join(root, 'identities', 'managed'),
      connectAgent,
    });

    expect(result.config.agent_key_ref).toEqual({
      provider: 'memory',
      key: agentKeyKey('agent-123'),
    });
    expect(result.config).not.toHaveProperty('oauth2');
    expect(provider.values.get(agentKeyKey('agent-123'))).toBe(
      'agent-key-secret',
    );
    expect(connectAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentKey: 'agent-key-secret' }),
    );
    expect(updateWhoamiFn).not.toHaveBeenCalled();
    expect(result.aliasPublished).toBe(false);
  });

  it('refuses an alias whose config already exists before any network call', async () => {
    const root = await freshRoot();
    const configDir = join(root, 'identities', 'taken');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'moltnet.json'), '{}');

    await expect(
      register({
        name: 'taken',
        apiUrl: 'https://api.example.test',
        secretProvider: memoryProvider(),
        configDir,
        connectAgent: fakeConnect().connectAgent,
      }),
    ).rejects.toMatchObject({ code: 'alias_exists' });
    expect(registerAgent).not.toHaveBeenCalled();
  });

  it('fails before registering when the provider cannot store', async () => {
    const root = await freshRoot();

    await expect(
      register({
        name: 'no-provider',
        apiUrl: 'https://api.example.test',
        secretProvider: memoryProvider(() => true),
        configDir: join(root, 'identities', 'no-provider'),
        connectAgent: fakeConnect().connectAgent,
      }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(registerAgent).not.toHaveBeenCalled();
  });

  it('removes the seed and writes nothing when the server rejects the registration', async () => {
    vi.mocked(registerAgent).mockResolvedValue({
      data: undefined,
      error: {
        type: 'urn:moltnet:problem:registration-failed',
        title: 'Registration failed',
        status: 403,
      },
    } as never);
    const root = await freshRoot();
    const configDir = join(root, 'identities', 'rejected');
    const provider = memoryProvider();

    await expect(
      register({
        name: 'rejected',
        apiUrl: 'https://api.example.test',
        secretProvider: provider,
        configDir,
        connectAgent: fakeConnect().connectAgent,
      }),
    ).rejects.toMatchObject({ code: 'registration_failed', statusCode: 403 });
    expect(provider.values.size).toBe(0);
    await expect(stat(join(configDir, 'moltnet.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps the seed when the transport fails after the replay', async () => {
    vi.mocked(registerAgent).mockRejectedValue(
      new TypeError('connection reset'),
    );
    const root = await freshRoot();
    const provider = memoryProvider();

    await expect(
      register({
        name: 'lost',
        apiUrl: 'https://api.example.test',
        secretProvider: provider,
        configDir: join(root, 'identities', 'lost'),
        connectAgent: fakeConnect().connectAgent,
      }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
      'dGVzdHByaXZrZXk=',
    );
  });

  it('leaves a recoverable config when the credential secret cannot be stored', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    const configDir = join(root, 'identities', 'flaky');
    const provider = memoryProvider(
      (key) => key === oauth2SecretKey('agent-123', 'client-id'),
    );

    const failure = await register({
      name: 'flaky',
      apiUrl: 'https://api.example.test',
      secretProvider: provider,
      configDir,
      connectAgent: fakeConnect().connectAgent,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RegisterIdentityError);
    expect(failure).toMatchObject({
      code: 'registration_incomplete',
      subjectId: 'agent-123',
      fingerprint: 'ABCD-1234-EF56-7890',
      configPath: join(configDir, 'moltnet.json'),
      recoveryCommand: expect.stringContaining(
        'moltnet agents credentials recover --yes',
      ),
    });
    const config = JSON.parse(
      await readFile(join(configDir, 'moltnet.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(config).toMatchObject({
      subject_id: 'agent-123',
      oauth2: { client_id: 'client-id' },
    });
    expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
      'dGVzdHByaXZrZXk=',
    );
  });

  it('rejects when the authenticated whoami names a different identity', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    const { connectAgent } = fakeConnect({
      whoami: { ...whoami, fingerprint: 'ZZZZ-0000-0000-0000' },
    });

    await expect(
      register({
        name: 'mismatch',
        apiUrl: 'https://api.example.test',
        secretProvider: memoryProvider(),
        configDir: join(root, 'identities', 'mismatch'),
        connectAgent,
      }),
    ).rejects.toMatchObject({ code: 'identity_mismatch' });
  });

  it('reports a failed alias publication without failing registration', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    const { connectAgent, updateWhoamiFn } = fakeConnect();
    updateWhoamiFn.mockRejectedValueOnce(
      new MoltNetError('forbidden', { code: 'FORBIDDEN', statusCode: 403 }),
    );

    const result = await register({
      name: 'unpublished',
      apiUrl: 'https://api.example.test',
      secretProvider: memoryProvider(),
      configDir: join(root, 'identities', 'unpublished'),
      connectAgent,
    });

    expect(result.aliasPublished).toBe(false);
  });

  it('defaults to the OS keyring provider and the identities directory', () => {
    // Only the defaults are checked here; the keyring adapter is never loaded.
    expect(new OSKeyringSecretProvider().name).toBe('os-keyring');
    expect(
      getIdentityDir('reg-test').endsWith(join('identities', 'reg-test')),
    ).toBe(true);
  });
});
