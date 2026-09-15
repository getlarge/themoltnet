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
  name = 'memory',
): SecretProvider & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    name,
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
  vi.unstubAllEnvs();
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
    expect(result.aliasPublication).toEqual({ status: 'published' });
    expect(result.whoami).toEqual(whoami);
    expect([...provider.values.keys()].sort()).toEqual(
      [
        identitySeedKey('ABCD-1234-EF56-7890'),
        oauth2SecretKey('agent-123', 'client-id'),
      ].sort(),
    );
  });

  it('bounds each registration attempt without replacing the caller signal', async () => {
    let attemptSignal: AbortSignal | undefined;
    vi.mocked(registerAgent).mockImplementation(((options: {
      signal?: AbortSignal;
    }) => {
      attemptSignal = options.signal;
      return Promise.resolve(success(oauthResponse));
    }) as typeof registerAgent);
    const root = await freshRoot();
    const controller = new AbortController();

    await register({
      name: 'bounded',
      apiUrl: 'https://api.example.test',
      secretProvider: memoryProvider(),
      configDir: join(root, 'identities', 'bounded'),
      connectAgent: fakeConnect().connectAgent,
      signal: controller.signal,
    });

    expect(attemptSignal).toBeInstanceOf(AbortSignal);
    expect(attemptSignal).not.toBe(controller.signal);
    expect(attemptSignal?.aborted).toBe(false);
    controller.abort();
    expect(attemptSignal?.aborted).toBe(true);
  });

  it('gives whoami and alias publication separate timeout budgets', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    const { connectAgent, whoamiFn, updateWhoamiFn } = fakeConnect();

    await register({
      name: 'budgets',
      apiUrl: 'https://api.example.test',
      secretProvider: memoryProvider(),
      configDir: join(root, 'identities', 'budgets'),
      connectAgent,
    });

    const [whoamiOptions] = whoamiFn.mock.calls[0] as [{ signal: AbortSignal }];
    const [, publishOptions] = updateWhoamiFn.mock.calls[0] as [
      unknown,
      { signal: AbortSignal },
    ];
    expect(whoamiOptions.signal).toBeInstanceOf(AbortSignal);
    expect(publishOptions.signal).toBeInstanceOf(AbortSignal);
    expect(publishOptions.signal).not.toBe(whoamiOptions.signal);
  });

  it('does not replay the registration once the caller has aborted', async () => {
    const controller = new AbortController();
    vi.mocked(registerAgent).mockImplementation((() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    }) as typeof registerAgent);
    const root = await freshRoot();

    await expect(
      register({
        name: 'aborted',
        apiUrl: 'https://api.example.test',
        secretProvider: memoryProvider(),
        configDir: join(root, 'identities', 'aborted'),
        connectAgent: fakeConnect().connectAgent,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code: 'registration_incomplete',
      subjectId: undefined,
    });
    expect(registerAgent).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid alias with a typed error before touching anything', async () => {
    const provider = memoryProvider();

    const failure = await register({
      name: '../escape',
      apiUrl: 'https://api.example.test',
      secretProvider: provider,
      connectAgent: fakeConnect().connectAgent,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RegisterIdentityError);
    expect(failure).toMatchObject({
      code: 'invalid_alias',
      nothingRegistered: true,
    });
    expect(provider.values.size).toBe(0);
    expect(registerAgent).not.toHaveBeenCalled();
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
    expect(result.aliasPublication).toEqual({ status: 'skipped' });
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
    ).rejects.toMatchObject({ code: 'alias_exists', nothingRegistered: true });
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
    ).rejects.toMatchObject({
      code: 'provider_unavailable',
      nothingRegistered: true,
    });
    expect(registerAgent).not.toHaveBeenCalled();
  });

  it('keeps the seed and writes no config when the server rejects the registration', async () => {
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
    ).rejects.toMatchObject({
      code: 'registration_failed',
      statusCode: 403,
      nothingRegistered: true,
      seedReference: {
        provider: 'memory',
        key: identitySeedKey('ABCD-1234-EF56-7890'),
      },
    });
    expect([...provider.values.keys()]).toEqual([
      identitySeedKey('ABCD-1234-EF56-7890'),
    ]);
    await expect(stat(join(configDir, 'moltnet.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([
    { status: 409, reason: 'a registration already in progress' },
    { status: 500, reason: 'a server error' },
  ])(
    'treats $reason ($status) as possibly committed and keeps the seed',
    async ({ status }) => {
      vi.mocked(registerAgent).mockResolvedValue({
        data: undefined,
        error: { type: 'urn:moltnet:problem:any', title: 'Failed', status },
      } as never);
      const root = await freshRoot();
      const provider = memoryProvider();

      await expect(
        register({
          name: 'unclear',
          apiUrl: 'https://api.example.test',
          secretProvider: provider,
          configDir: join(root, 'identities', 'unclear'),
          connectAgent: fakeConnect().connectAgent,
        }),
      ).rejects.toMatchObject({
        code: 'registration_incomplete',
        subjectId: undefined,
        nothingRegistered: false,
        seedReference: {
          provider: 'memory',
          key: identitySeedKey('ABCD-1234-EF56-7890'),
        },
      });
      expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
        'dGVzdHByaXZrZXk=',
      );
    },
  );

  it('keeps the seed and writes no config when the credential type is unexpected', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(agentKeyResponse));
    const root = await freshRoot();
    const configDir = join(root, 'identities', 'wrong-type');
    const provider = memoryProvider();

    const failure = await register({
      name: 'wrong-type',
      apiUrl: 'https://api.example.test',
      secretProvider: provider,
      configDir,
      connectAgent: fakeConnect().connectAgent,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'unsupported_credential',
      subjectId: 'agent-123',
      seedReference: {
        provider: 'memory',
        key: identitySeedKey('ABCD-1234-EF56-7890'),
      },
      recoveryCommand: undefined,
    });
    expect([...provider.values.keys()]).toEqual([
      identitySeedKey('ABCD-1234-EF56-7890'),
    ]);
    await expect(stat(join(configDir, 'moltnet.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps the seed and names the race when another process creates the identity during registration', async () => {
    const root = await freshRoot();
    const configDir = join(root, 'identities', 'raced');
    vi.mocked(registerAgent).mockImplementation(async () => {
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'moltnet.json'), '{"winner":true}');
      return success(oauthResponse);
    });
    const provider = memoryProvider();

    const failure = await register({
      name: 'raced',
      apiUrl: 'https://api.example.test',
      secretProvider: provider,
      configDir,
      connectAgent: fakeConnect().connectAgent,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'registration_incomplete',
      subjectId: 'agent-123',
      recoveryCommand: undefined,
      message: expect.stringContaining('created by another process'),
    });
    expect(await readFile(join(configDir, 'moltnet.json'), 'utf-8')).toBe(
      '{"winner":true}',
    );
    expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
      'dGVzdHByaXZrZXk=',
    );
  });

  it('keeps the seed when the config cannot be written', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    // A file where the identity directory belongs makes the write fail.
    const configDir = join(root, 'identities', 'blocked');
    await mkdir(join(root, 'identities'), { recursive: true });
    await writeFile(configDir, 'not a directory');
    const provider = memoryProvider();

    const failure = await register({
      name: 'blocked',
      apiUrl: 'https://api.example.test',
      secretProvider: provider,
      configDir,
      connectAgent: fakeConnect().connectAgent,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'registration_incomplete',
      subjectId: 'agent-123',
      recoveryCommand: undefined,
      seedReference: {
        provider: 'memory',
        key: identitySeedKey('ABCD-1234-EF56-7890'),
      },
      message: expect.stringContaining('its config could not be written'),
    });
    expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
      'dGVzdHByaXZrZXk=',
    );
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
    ).rejects.toMatchObject({
      code: 'registration_incomplete',
      subjectId: undefined,
      cause: expect.any(NetworkError),
      seedReference: {
        provider: 'memory',
        key: identitySeedKey('ABCD-1234-EF56-7890'),
      },
    });
    expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
      'dGVzdHByaXZrZXk=',
    );
  });

  it('offers the CLI recovery command for the default store and OS keyring', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    vi.stubEnv('HOME', root);
    const provider = memoryProvider(
      (key) => key === oauth2SecretKey('agent-123', 'client-id'),
      'os-keyring',
    );
    const { connectAgent } = fakeConnect();

    const failure = await register({
      name: 'flaky',
      apiUrl: 'https://api.example.test',
      secretProvider: provider,
      connectAgent,
    }).catch((error: unknown) => error);

    const configPath = join(getIdentityDir('flaky'), 'moltnet.json');
    expect(failure).toBeInstanceOf(RegisterIdentityError);
    expect(failure).toMatchObject({
      code: 'registration_incomplete',
      subjectId: 'agent-123',
      fingerprint: 'ABCD-1234-EF56-7890',
      configPath,
      recoveryCommand:
        'MOLTNET_ACTIVE_IDENTITY=flaky moltnet agents credentials recover --yes',
      seedReference: {
        provider: 'os-keyring',
        key: identitySeedKey('ABCD-1234-EF56-7890'),
      },
    });
    // The secret is stored before the whoami, so a failed store never verifies.
    expect(connectAgent).not.toHaveBeenCalled();
    expect(
      JSON.parse(await readFile(configPath, 'utf-8')) as Record<
        string,
        unknown
      >,
    ).toMatchObject({
      subject_id: 'agent-123',
      oauth2: { client_id: 'client-id' },
    });
    expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
      'dGVzdHByaXZrZXk=',
    );
  });

  it('names the kept material instead of a CLI command for a custom store', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    const configDir = join(root, 'identities', 'unverified');
    const provider = memoryProvider();
    const connectAgent = vi
      .fn()
      .mockRejectedValue(new NetworkError('connection reset'));

    const failure = await register({
      name: 'unverified',
      apiUrl: 'https://api.example.test',
      secretProvider: provider,
      configDir,
      connectAgent,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'registration_incomplete',
      subjectId: 'agent-123',
      fingerprint: 'ABCD-1234-EF56-7890',
      configPath: join(configDir, 'moltnet.json'),
      recoveryCommand: undefined,
      seedReference: {
        provider: 'memory',
        key: identitySeedKey('ABCD-1234-EF56-7890'),
      },
      message: expect.stringContaining(
        `the config at ${join(configDir, 'moltnet.json')}`,
      ),
    });
    expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
      'dGVzdHByaXZrZXk=',
    );
    expect(provider.values.get(oauth2SecretKey('agent-123', 'client-id'))).toBe(
      'client-secret',
    );
  });

  it('reports a written config whose default identity could not be selected', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    vi.stubEnv('HOME', root);
    // A directory where the selector file belongs makes seeding it fail.
    await mkdir(join(root, '.config', 'moltnet', 'identity-selector.json'), {
      recursive: true,
    });

    const failure = await register({
      name: 'unselected',
      apiUrl: 'https://api.example.test',
      secretProvider: memoryProvider(undefined, 'os-keyring'),
      connectAgent: fakeConnect().connectAgent,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'registration_incomplete',
      subjectId: 'agent-123',
      recoveryCommand:
        'MOLTNET_ACTIVE_IDENTITY=unselected moltnet agents credentials recover --yes',
      message: expect.stringContaining(
        'could not be selected as the default identity',
      ),
    });
    await expect(
      stat(join(getIdentityDir('unselected'), 'moltnet.json')),
    ).resolves.toBeDefined();
  });

  it.each([
    {
      field: 'fingerprint',
      whoami: { ...whoami, fingerprint: 'ZZZZ-0000-0000-0000' },
      named: 'fingerprint ZZZZ-0000-0000-0000',
    },
    {
      field: 'a missing public key',
      whoami: { ...whoami, publicKey: undefined },
      named: 'public key (none)',
    },
  ])(
    'rejects a whoami with a mismatched $field and names what it returned',
    async ({ whoami: returned, named }) => {
      vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
      const root = await freshRoot();
      const configDir = join(root, 'identities', 'mismatch');
      const provider = memoryProvider();

      const failure = await register({
        name: 'mismatch',
        apiUrl: 'https://api.example.test',
        secretProvider: provider,
        configDir,
        connectAgent: fakeConnect({ whoami: returned }).connectAgent,
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: 'identity_mismatch',
        configPath: join(configDir, 'moltnet.json'),
        recoveryCommand: undefined,
        seedReference: {
          provider: 'memory',
          key: identitySeedKey('ABCD-1234-EF56-7890'),
        },
        message: expect.stringContaining(named),
      });
      await expect(
        stat(join(configDir, 'moltnet.json')),
      ).resolves.toBeDefined();
      expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
        'dGVzdHByaXZrZXk=',
      );
    },
  );

  it('reports a failed alias publication with its reason without failing registration', async () => {
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

    expect(result.aliasPublication).toEqual({
      status: 'failed',
      error: 'forbidden',
    });
  });

  it('skips alias publication for OAuth2 when publishAlias is false', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    const { connectAgent, updateWhoamiFn } = fakeConnect();

    const result = await register({
      name: 'quiet',
      apiUrl: 'https://api.example.test',
      secretProvider: memoryProvider(),
      configDir: join(root, 'identities', 'quiet'),
      connectAgent,
      publishAlias: false,
    });

    expect(updateWhoamiFn).not.toHaveBeenCalled();
    expect(result.aliasPublication).toEqual({ status: 'skipped' });
  });

  it('defaults to the OS keyring provider and the identities directory', () => {
    // Only the defaults are checked here; the keyring adapter is never loaded.
    expect(new OSKeyringSecretProvider().name).toBe('os-keyring');
    expect(
      getIdentityDir('reg-test').endsWith(join('identities', 'reg-test')),
    ).toBe(true);
  });
});
