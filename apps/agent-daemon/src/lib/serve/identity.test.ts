import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type * as Sdk from '@themoltnet/sdk';
import {
  type MoltNetConfig,
  MoltNetError,
  READ_ONLY_CAPABILITIES,
  SecretProviderRegistry,
  type Whoami,
} from '@themoltnet/sdk';
import type * as SdkNode from '@themoltnet/sdk/node';
import { FileSecretProvider } from '@themoltnet/sdk/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachExternalAgent,
  createManagedAgent,
  reconcileManagedRegistration,
  verifyAgentActivation,
} from './identity.js';
import { ServeStore } from './store.js';

const { connectMock, registerMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  registerMock: vi.fn(),
}));

vi.mock('@themoltnet/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  register: registerMock,
}));
vi.mock('@themoltnet/sdk/node', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkNode>()),
  connect: connectMock,
}));

const roots: string[] = [];
const whoami: Whoami = {
  identityId: 'identity-1',
  publicKey: 'ed25519:public',
  fingerprint: 'FP-1',
  subjectType: 'agent',
};

function freshStore(): ServeStore {
  const root = mkdtempSync(join(tmpdir(), 'serve-identity-'));
  roots.push(root);
  return new ServeStore(join(root, 'serve')).ensure();
}

function externalConfig(overrides: Partial<MoltNetConfig> = {}): MoltNetConfig {
  return {
    identity_id: 'identity-1',
    registered_at: '2026-01-01T00:00:00Z',
    oauth2: { client_id: 'client', client_secret: 'oauth-secret' },
    keys: {
      public_key: 'ed25519:public',
      private_key: 'seed',
      fingerprint: 'FP-1',
    },
    endpoints: {
      api: 'https://api.themolt.net',
      mcp: 'https://mcp.themolt.net',
    },
    ...overrides,
  };
}

function writeExternalConfig(
  config: MoltNetConfig,
  agentName = 'configured-agent',
): string {
  const root = mkdtempSync(join(tmpdir(), 'external-agent-root-'));
  roots.push(root);
  const configDir = join(root, '.moltnet', agentName);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'moltnet.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  return configDir;
}

function registry(values: Record<string, string> = {}): SecretProviderRegistry {
  return new SecretProviderRegistry().register({
    name: 'file',
    capabilities: READ_ONLY_CAPABILITIES,
    read: (key) => Promise.resolve(values[key] ?? null),
    probe: (key) => Promise.resolve(key in values ? 'present' : 'absent'),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  connectMock.mockResolvedValue({
    agents: { whoami: vi.fn().mockResolvedValue(whoami) },
  });
  registerMock.mockResolvedValue({
    identity: {
      identityId: 'identity-1',
      publicKey: 'ed25519:public',
      privateKey: 'private-seed',
      fingerprint: 'FP-1',
    },
    credentials: { type: 'agent_key', secret: 'agent-key-secret' },
    apiUrl: 'https://api.themolt.net',
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('managed serve agents', () => {
  it('rejects remote plaintext registration before reserving or registering', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });

    await expect(
      createManagedAgent(store, secrets, {
        name: 'unsafe',
        apiUrl: 'http://api.example.test',
        enrollmentToken: 'enrollment-secret',
      }),
    ).rejects.toMatchObject({ code: 'registration_failed' });

    expect(registerMock).not.toHaveBeenCalled();
    expect(store.hasPendingRegistration('unsafe')).toBe(false);
  });

  it('reserves an alias while registration is in flight', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });
    let registrationStarted!: () => void;
    let finishRegistration!: () => void;
    const started = new Promise<void>((resolvePromise) => {
      registrationStarted = resolvePromise;
    });
    const finish = new Promise<void>((resolvePromise) => {
      finishRegistration = resolvePromise;
    });
    registerMock.mockImplementationOnce(async () => {
      registrationStarted();
      await finish;
      return {
        identity: {
          identityId: 'identity-1',
          publicKey: 'ed25519:public',
          privateKey: 'private-seed',
          fingerprint: 'FP-1',
        },
        credentials: { type: 'agent_key' as const, secret: 'agent-key-secret' },
        apiUrl: 'https://api.themolt.net',
      };
    });

    const first = createManagedAgent(store, secrets, {
      name: 'same-alias',
      apiUrl: 'https://api.themolt.net',
      enrollmentToken: 'enroll-tok',
    });
    await started;
    await expect(
      createManagedAgent(store, secrets, {
        name: 'same-alias',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).rejects.toMatchObject({ code: 'agent_exists' });
    finishRegistration();
    await expect(first).resolves.toMatchObject({
      activation: { alias: 'same-alias' },
    });
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it('persists an exact agent-key-only MoltNetConfig without secret values', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });

    const result = await createManagedAgent(store, secrets, {
      name: 'course-bot',
      apiUrl: 'https://api.themolt.net',
      enrollmentToken: 'enroll-tok',
    });

    expect(result.config.registered_at).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(result.config).toEqual({
      identity_id: 'identity-1',
      registered_at: result.config.registered_at,
      agent_key_ref: { provider: 'file', key: 'agent-key/identity-1' },
      keys: {
        public_key: 'ed25519:public',
        fingerprint: 'FP-1',
        private_key_ref: { provider: 'file', key: 'identity/FP-1/seed' },
      },
      endpoints: {
        api: 'https://api.themolt.net',
        mcp: 'https://mcp.themolt.net/mcp',
      },
    });
    const raw = readFileSync(store.agentPath('course-bot'), 'utf8');
    expect(raw).not.toContain('agent-key-secret');
    expect(raw).not.toContain('private-seed');
    expect(raw).not.toContain('agentName');
    expect(raw).not.toContain('agentKeyRef');
    expect(JSON.parse(raw)).toEqual(result.config);
    expect(store.readActivation('course-bot')).toMatchObject({
      alias: 'course-bot',
      source: 'managed',
      identityId: 'identity-1',
      publicKey: 'ed25519:public',
      fingerprint: 'FP-1',
    });
  });

  it('preserves a recovery record and blocks retry after partial persistence', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });
    vi.spyOn(store, 'writeActivation').mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    await expect(
      createManagedAgent(store, secrets, {
        name: 'partial',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).rejects.toMatchObject({ code: 'registration_incomplete' });
    expect(store.readAgentConfig('partial')).toMatchObject({
      identity_id: 'identity-1',
    });
    expect(store.hasPendingRegistration('partial')).toBe(true);
    await expect(
      createManagedAgent(store, secrets, {
        name: 'partial',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).rejects.toMatchObject({ code: 'agent_exists' });
    expect(registerMock).toHaveBeenCalledTimes(1);

    await expect(
      reconcileManagedRegistration(store, secrets, 'partial', 'resume'),
    ).resolves.toMatchObject({
      activation: { alias: 'partial', identityId: 'identity-1' },
    });
    expect(store.hasPendingRegistration('partial')).toBe(false);
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it('explicitly abandons incomplete local registration artifacts', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });
    vi.spyOn(secrets, 'write').mockRejectedValueOnce(new Error('disk full'));
    await expect(
      createManagedAgent(store, secrets, {
        name: 'abandoned',
        apiUrl: 'https://api.themolt.net',
      }),
    ).rejects.toMatchObject({ code: 'registration_incomplete' });

    await expect(
      reconcileManagedRegistration(store, secrets, 'abandoned', 'abandon'),
    ).resolves.toBeNull();
    expect(store.hasPendingRegistration('abandoned')).toBe(false);
    expect(store.readAgentConfig('abandoned')).toBeNull();
  });

  it('abandons metadata without deleting config-selected secret keys', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });
    vi.spyOn(store, 'writeActivation').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await expect(
      createManagedAgent(store, secrets, {
        name: 'tampered',
        apiUrl: 'https://api.themolt.net',
      }),
    ).rejects.toMatchObject({ code: 'registration_incomplete' });
    await secrets.write('agent-key/victim', 'victim-secret');
    const config = store.readAgentConfig('tampered');
    if (!config) throw new Error('pending config missing');
    config.agent_key_ref = { provider: 'file', key: 'agent-key/victim' };
    store.writeAgentConfig('tampered', config);

    await expect(
      reconcileManagedRegistration(store, secrets, 'tampered', 'abandon'),
    ).resolves.toBeNull();

    await expect(secrets.read('agent-key/victim')).resolves.toBe(
      'victim-secret',
    );
    expect(store.hasPendingRegistration('tampered')).toBe(false);
    expect(store.readAgentConfig('tampered')).toBeNull();
  });

  it('blocks retry when registration fails after its durable reservation', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });
    registerMock.mockRejectedValueOnce(new Error('response lost'));

    await expect(
      createManagedAgent(store, secrets, {
        name: 'uncertain',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).rejects.toMatchObject({ code: 'registration_incomplete' });
    expect(store.hasPendingRegistration('uncertain')).toBe(true);

    await expect(
      createManagedAgent(store, secrets, {
        name: 'uncertain',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).rejects.toMatchObject({ code: 'agent_exists' });
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it('clears the reservation after a definitive registration rejection', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });
    registerMock.mockRejectedValueOnce(
      new MoltNetError('bad enrollment token', {
        code: 'INVALID_TOKEN',
        statusCode: 400,
      }),
    );

    await expect(
      createManagedAgent(store, secrets, {
        name: 'retryable',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).rejects.toMatchObject({ code: 'registration_failed' });
    expect(store.hasPendingRegistration('retryable')).toBe(false);

    await expect(
      createManagedAgent(store, secrets, {
        name: 'retryable',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).resolves.toMatchObject({ activation: { alias: 'retryable' } });
    expect(registerMock).toHaveBeenCalledTimes(2);
  });

  it('re-verifies a valid managed activation through the registry', async () => {
    const store = freshStore();
    const { oauth2: _oauth2, ...agentKeyOnly } = externalConfig();
    store.writeAgentConfig('managed', {
      ...agentKeyOnly,
      endpoints: {
        api: 'https://custom.example',
        mcp: 'https://custom.example/mcp',
      },
      agent_key_ref: { provider: 'file', key: 'agent-key/identity-1' },
      keys: {
        public_key: 'ed25519:public',
        fingerprint: 'FP-1',
        private_key_ref: { provider: 'file', key: 'identity/FP-1/seed' },
      },
    });
    store.writeActivation({
      alias: 'managed',
      source: 'managed',
      identityId: 'identity-1',
      publicKey: 'ed25519:public',
      fingerprint: 'FP-1',
      createdAt: 't',
      apiUrl: 'https://custom.example',
    });

    await expect(
      verifyAgentActivation(
        store,
        'managed',
        registry({ 'agent-key/identity-1': 'resolved-agent-key' }),
        registry(),
      ),
    ).resolves.toMatchObject({ activation: { alias: 'managed' } });
    expect(connectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: 'resolved-agent-key',
        apiUrl: 'https://custom.example',
      }),
    );
    const connectOptions = connectMock.mock.lastCall?.[0] as
      | Parameters<typeof SdkNode.connect>[0]
      | undefined;
    expect(connectOptions?.signal).toBeInstanceOf(AbortSignal);

    const changed = store.readAgentConfig('managed');
    if (!changed) throw new Error('managed test config missing');
    changed.endpoints.api = 'https://changed.example';
    store.writeAgentConfig('managed', changed);
    connectMock.mockClear();
    await expect(
      verifyAgentActivation(
        store,
        'managed',
        registry({ 'agent-key/identity-1': 'resolved-agent-key' }),
        registry(),
      ),
    ).rejects.toThrow('API endpoint does not match its pinned activation');
    expect(connectMock).not.toHaveBeenCalled();
  });
});

describe('external serve agents', () => {
  it('propagates cancellation through external whoami authentication', async () => {
    const store = freshStore();
    const configDir = writeExternalConfig(externalConfig());
    const controller = new AbortController();
    controller.abort();
    connectMock.mockImplementationOnce(
      async (options: NonNullable<Parameters<typeof SdkNode.connect>[0]>) => {
        expect(options.signal?.aborted).toBe(true);
        return {
          agents: {
            whoami: vi.fn(({ signal }: { signal?: AbortSignal } = {}) => {
              expect(signal?.aborted).toBe(true);
              return Promise.reject(new Error('aborted'));
            }),
          },
        };
      },
    );

    await expect(
      attachExternalAgent(store, registry(), {
        name: 'cancelled',
        configDir,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
    expect(store.readActivation('cancelled')).toBeNull();
  });

  it('rejects a remote plaintext API override before connecting', async () => {
    const store = freshStore();
    const configDir = writeExternalConfig(externalConfig());

    await expect(
      attachExternalAgent(store, registry(), {
        name: 'external',
        configDir,
        apiUrl: 'http://remote.example.test',
      }),
    ).rejects.toThrow('does not match its configured endpoint');
    expect(connectMock).not.toHaveBeenCalled();
    expect(store.readActivation('external')).toBeNull();
  });

  it('pins an authenticated config path with a matching API endpoint', async () => {
    const store = freshStore();
    const configDir = writeExternalConfig(externalConfig());

    await attachExternalAgent(store, registry(), {
      name: 'external',
      configDir,
      apiUrl: 'https://api.themolt.net',
    });

    expect(store.readActivation('external')).toMatchObject({
      source: 'external',
      configPath: join(configDir, 'moltnet.json'),
      apiUrl: 'https://api.themolt.net',
      identityId: 'identity-1',
      publicKey: 'ed25519:public',
      fingerprint: 'FP-1',
    });
    expect(store.readAgentConfig('external')).toBeNull();
    expect(connectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        configDir,
        apiUrl: 'https://api.themolt.net',
      }),
    );
  });

  it('rejects attach-time identity mismatches', async () => {
    const store = freshStore();
    const configDir = writeExternalConfig(
      externalConfig({ identity_id: 'different' }),
    );

    await expect(
      attachExternalAgent(store, registry(), {
        name: 'external',
        configDir,
      }),
    ).rejects.toMatchObject({
      code: 'verification_failed',
    });
    expect(store.readActivation('external')).toBeNull();
  });

  it.each([
    ['identity id', { identity_id: 'changed' }],
    [
      'public key',
      {
        keys: {
          public_key: 'changed',
          private_key: 'seed',
          fingerprint: 'FP-1',
        },
      },
    ],
    [
      'fingerprint',
      {
        keys: {
          public_key: 'ed25519:public',
          private_key: 'seed',
          fingerprint: 'changed',
        },
      },
    ],
  ])('rejects a changed current config %s', async (_field, change) => {
    const store = freshStore();
    const configDir = writeExternalConfig(externalConfig());
    await attachExternalAgent(store, registry(), {
      name: 'external',
      configDir,
    });
    writeFileSync(
      join(configDir, 'moltnet.json'),
      JSON.stringify(externalConfig(change as Partial<MoltNetConfig>)),
    );

    await expect(
      verifyAgentActivation(store, 'external', registry(), registry()),
    ).rejects.toMatchObject({
      code: 'verification_failed',
    });
  });

  it('rejects a changed current config API endpoint', async () => {
    const store = freshStore();
    const configDir = writeExternalConfig(externalConfig());
    await attachExternalAgent(store, registry(), {
      name: 'external',
      configDir,
    });
    writeFileSync(
      join(configDir, 'moltnet.json'),
      JSON.stringify(
        externalConfig({
          endpoints: {
            api: 'https://other.themolt.net',
            mcp: 'https://mcp.themolt.net',
          },
        }),
      ),
    );

    await expect(
      verifyAgentActivation(store, 'external', registry(), registry()),
    ).rejects.toThrow('API endpoint does not match its pinned activation');
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['identity id', { identityId: 'changed' }],
    ['public key', { publicKey: 'changed' }],
    ['fingerprint', { fingerprint: 'changed' }],
  ])('rejects a run-time whoami %s mismatch', async (_field, change) => {
    const store = freshStore();
    const configDir = writeExternalConfig(externalConfig());
    await attachExternalAgent(store, registry(), {
      name: 'external',
      configDir,
    });
    connectMock.mockResolvedValueOnce({
      agents: {
        whoami: vi.fn().mockResolvedValue({ ...whoami, ...change }),
      },
    });

    await expect(
      verifyAgentActivation(store, 'external', registry(), registry()),
    ).rejects.toMatchObject({
      code: 'verification_failed',
    });
  });

  it('rejects a moved or missing external config and accepts valid reactivation', async () => {
    const store = freshStore();
    const configDir = writeExternalConfig(externalConfig());
    await attachExternalAgent(store, registry(), {
      name: 'external',
      configDir,
    });

    await expect(
      verifyAgentActivation(store, 'external', registry(), registry()),
    ).resolves.toMatchObject({ activation: { alias: 'external' } });

    const movedDir = join(configDir, 'moved');
    mkdirSync(movedDir);
    renameSync(join(configDir, 'moltnet.json'), join(movedDir, 'moltnet.json'));
    await expect(
      verifyAgentActivation(store, 'external', registry(), registry()),
    ).rejects.toMatchObject({
      code: 'config_not_found',
    });
  });

  it('rejects external configs larger than the fixed read limit', async () => {
    const store = freshStore();
    const configDir = writeExternalConfig(externalConfig());
    writeFileSync(join(configDir, 'moltnet.json'), 'x'.repeat(64 * 1024 + 1));

    await expect(
      attachExternalAgent(store, registry(), {
        name: 'oversized',
        configDir,
      }),
    ).rejects.toThrow('no larger than 65536 bytes');
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('does not include malformed config contents in verification errors', async () => {
    const store = freshStore();
    const configDir = writeExternalConfig(externalConfig());
    writeFileSync(
      join(configDir, 'moltnet.json'),
      '{"oauth2":{"client_secret":"do-not-leak"}',
    );

    let thrown: unknown;
    try {
      await attachExternalAgent(store, registry(), {
        name: 'malformed',
        configDir,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'verification_failed' });
    expect((thrown as Error).message).toBe(
      `agent config is not valid JSON at ${join(configDir, 'moltnet.json')}`,
    );
    expect((thrown as Error).message).not.toContain('do-not-leak');
  });
});
