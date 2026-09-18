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

import type * as ApiClient from '@moltnet/api-client';
import type * as CryptoService from '@moltnet/crypto-service';
import {
  AuthenticationError,
  type MoltNetConfig,
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
import { AgentServerStore } from './store.js';

const { connectMock, enrollMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  enrollMock: vi.fn(),
}));

// The SDK register runs for real against the temp store; only the network
// (API client), the keypair, and the post-registration connection are faked.
vi.mock('@moltnet/crypto-service', async (importOriginal) => ({
  ...(await importOriginal<typeof CryptoService>()),
  cryptoService: {
    generateKeyPair: vi.fn().mockResolvedValue({
      publicKey: 'ed25519:public',
      privateKey: 'private-seed',
      fingerprint: 'FP-1',
    }),
    sign: vi.fn().mockResolvedValue('registration-proof'),
    verify: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('@moltnet/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  createClient: vi.fn().mockReturnValue({}),
  enrollAgent: enrollMock,
}));
vi.mock('@themoltnet/sdk/node', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkNode>()),
  connect: connectMock,
}));

const enrollmentPayload = () =>
  ({
    data: {
      agentId: 'agent-1',
      identityId: 'identity-1',
      fingerprint: 'FP-1',
      publicKey: 'ed25519:public',
      credential: {
        type: 'agent_key',
        key: {
          id: 'key-1',
          agentId: 'agent-1',
          bindingScope: 'team',
          teamId: 'team-1',
        },
        secret: 'agent-key-secret',
      },
    },
    error: undefined,
    request: new Request('http://localhost'),
    response: new Response(),
  }) as never;

const roots: string[] = [];
const whoami: Whoami = {
  subjectId: 'agent-1',
  identityId: 'identity-1',
  publicKey: 'ed25519:public',
  fingerprint: 'FP-1',
  subjectType: 'agent',
};

function freshStore(): AgentServerStore {
  const root = mkdtempSync(join(tmpdir(), 'agent-server-identity-'));
  roots.push(root);
  return new AgentServerStore(join(root, 'agent-server')).ensure();
}

function externalConfig(overrides: Partial<MoltNetConfig> = {}): MoltNetConfig {
  return {
    subject_id: 'agent-1',
    subject_type: 'agent',
    registered_at: '2026-01-01T00:00:00Z',
    oauth2: { client_id: 'client', client_secret: 'oauth-secret' },
    agent_key_ref: { provider: 'file', key: 'agent-key/agent-1' },
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

function registry(
  values: Record<string, string> = {
    'agent-key/agent-1': 'resolved-agent-key',
  },
): SecretProviderRegistry {
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
  enrollMock.mockResolvedValue(enrollmentPayload());
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('managed agent server agents', () => {
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

    expect(enrollMock).not.toHaveBeenCalled();
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
    enrollMock.mockImplementationOnce(async () => {
      registrationStarted();
      await finish;
      return enrollmentPayload();
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
    expect(enrollMock).toHaveBeenCalledTimes(1);
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
      subject_id: 'agent-1',
      subject_type: 'agent',
      registered_at: result.config.registered_at,
      agent_key_refs: {
        'team-1': { provider: 'file', key: 'agent-key/agent-1/team-1' },
      },
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
      subjectId: 'agent-1',
      publicKey: 'ed25519:public',
      fingerprint: 'FP-1',
    });
  });

  it('pins the authenticated team binding and rejects a changed binding later', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });
    connectMock.mockResolvedValueOnce({
      agents: {
        whoami: vi.fn().mockResolvedValue({
          ...whoami,
          credentialBinding: {
            bindingScope: 'team',
            boundTeamId: 'team-1',
            keyId: 'key-1',
          },
        }),
      },
    });

    const created = await createManagedAgent(store, secrets, {
      name: 'team-bot',
      apiUrl: 'https://api.themolt.net',
      enrollmentToken: 'enroll-tok',
    });

    expect(created).toMatchObject({
      activation: { boundTeamId: 'team-1' },
      boundTeamId: 'team-1',
    });
    connectMock.mockResolvedValueOnce({
      agents: {
        whoami: vi.fn().mockResolvedValue({
          ...whoami,
          credentialBinding: {
            bindingScope: 'team',
            boundTeamId: 'team-changed',
            keyId: 'key-1',
          },
        }),
      },
    });
    await expect(
      verifyAgentActivation(
        store,
        'team-bot',
        registry({ 'agent-key/agent-1/team-1': 'agent-key-secret' }),
        registry(),
      ),
    ).rejects.toThrow('team binding does not match');
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

    const partial = createManagedAgent(store, secrets, {
      name: 'partial',
      apiUrl: 'https://api.themolt.net',
      enrollmentToken: 'enroll-tok',
    });
    await expect(partial).rejects.toMatchObject({
      code: 'registration_incomplete',
    });
    // The registration committed, so the message names the agent and the
    // reconcile call rather than asking the operator to look it up.
    await expect(partial).rejects.toThrow(
      'the remote agent agent-1 was registered but local activation is incomplete. Finish it with POST /v1/agents/partial/reconcile and {"action":"resume"}',
    );
    expect(store.readAgentConfig('partial')).toMatchObject({
      subject_id: 'agent-1',
      subject_type: 'agent',
    });
    expect(store.hasPendingRegistration('partial')).toBe(true);
    await expect(
      createManagedAgent(store, secrets, {
        name: 'partial',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).rejects.toMatchObject({ code: 'agent_exists' });
    expect(enrollMock).toHaveBeenCalledTimes(1);

    await expect(
      reconcileManagedRegistration(store, secrets, 'partial', 'resume'),
    ).resolves.toMatchObject({
      activation: { alias: 'partial', subjectId: 'agent-1' },
    });
    expect(store.hasPendingRegistration('partial')).toBe(false);
    expect(enrollMock).toHaveBeenCalledTimes(1);
  });

  it('explicitly abandons incomplete local registration artifacts', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });
    // The preflight probe and the seed write succeed; only the credential
    // write fails, which is the last step before the whoami check.
    const realWrite = secrets.write.bind(secrets);
    vi.spyOn(secrets, 'write').mockImplementation((key, value) =>
      key.startsWith('agent-key/')
        ? Promise.reject(new Error('disk full'))
        : realWrite(key, value),
    );
    const failed = createManagedAgent(store, secrets, {
      name: 'abandoned',
      apiUrl: 'https://api.themolt.net',
      enrollmentToken: 'enroll-tok',
    });
    await expect(failed).rejects.toMatchObject({
      code: 'registration_incomplete',
    });
    await expect(failed).rejects.toThrow('credential-recovery');

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
        enrollmentToken: 'enroll-tok',
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
    // The SDK replays a dropped response once with the same signed request.
    enrollMock
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockRejectedValueOnce(new TypeError('response lost'));

    const uncertain = createManagedAgent(store, secrets, {
      name: 'uncertain',
      apiUrl: 'https://api.themolt.net',
      enrollmentToken: 'enroll-tok',
    });
    await expect(uncertain).rejects.toMatchObject({
      code: 'registration_incomplete',
    });
    await expect(uncertain).rejects.toThrow(
      'registration for "uncertain" may have completed on the server (fingerprint FP-1); look the agent up first. No local config was written, so it cannot be resumed; discard the local record with POST /v1/agents/uncertain/reconcile and {"action":"abandon"}.',
    );
    expect(store.hasPendingRegistration('uncertain')).toBe(true);

    await expect(
      createManagedAgent(store, secrets, {
        name: 'uncertain',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).rejects.toMatchObject({ code: 'agent_exists' });
    expect(enrollMock).toHaveBeenCalledTimes(2);
  });

  it('clears the reservation when the secret store fails before registering', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });
    // The preflight probe is the first write.
    vi.spyOn(secrets, 'write').mockRejectedValueOnce(new Error('read-only'));

    await expect(
      createManagedAgent(store, secrets, {
        name: 'no-store',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).rejects.toMatchObject({ code: 'registration_failed' });
    expect(enrollMock).not.toHaveBeenCalled();
    expect(store.hasPendingRegistration('no-store')).toBe(false);

    await expect(
      createManagedAgent(store, secrets, {
        name: 'no-store',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).resolves.toMatchObject({ activation: { alias: 'no-store' } });
  });

  it('reports an existing identity found by the SDK as agent_exists', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });
    // A config the store could not read, so the reservation let it through.
    mkdirSync(store.identityDir('unreadable'), { recursive: true });
    writeFileSync(store.agentPath('unreadable'), '{}');
    vi.spyOn(store, 'readAgentConfig').mockReturnValue(null);

    await expect(
      createManagedAgent(store, secrets, {
        name: 'unreadable',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).rejects.toMatchObject({ code: 'agent_exists' });
    expect(enrollMock).not.toHaveBeenCalled();
    expect(store.hasPendingRegistration('unreadable')).toBe(false);
  });

  it('clears the reservation after a definitive registration rejection', async () => {
    const store = freshStore();
    const secrets = new FileSecretProvider({
      root: store.secretsDir,
      writable: true,
    });
    enrollMock.mockResolvedValueOnce({
      data: undefined,
      error: {
        type: 'urn:moltnet:problem:invalid-token',
        title: 'Registration failed',
        detail: 'bad enrollment token',
        status: 400,
      },
    } as never);

    const rejection = createManagedAgent(store, secrets, {
      name: 'retryable',
      apiUrl: 'https://api.themolt.net',
      enrollmentToken: 'enroll-tok',
    });
    await expect(rejection).rejects.toMatchObject({
      code: 'registration_failed',
    });
    await expect(rejection).rejects.toThrow(
      'registration for "retryable" was rejected (400): bad enrollment token',
    );
    // The rejected registration keeps its seed; only an unused entry remains.
    await expect(secrets.probe('identity/FP-1/seed')).resolves.toBe('present');
    expect(store.hasPendingRegistration('retryable')).toBe(false);

    await expect(
      createManagedAgent(store, secrets, {
        name: 'retryable',
        apiUrl: 'https://api.themolt.net',
        enrollmentToken: 'enroll-tok',
      }),
    ).resolves.toMatchObject({ activation: { alias: 'retryable' } });
    expect(enrollMock).toHaveBeenCalledTimes(2);
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
      agent_key_ref: { provider: 'file', key: 'agent-key/agent-1' },
      keys: {
        public_key: 'ed25519:public',
        fingerprint: 'FP-1',
        private_key_ref: { provider: 'file', key: 'identity/FP-1/seed' },
      },
    });
    store.writeActivation({
      alias: 'managed',
      source: 'managed',
      subjectId: 'agent-1',
      publicKey: 'ed25519:public',
      fingerprint: 'FP-1',
      createdAt: 't',
      apiUrl: 'https://custom.example',
    });

    await expect(
      verifyAgentActivation(
        store,
        'managed',
        registry({ 'agent-key/agent-1': 'resolved-agent-key' }),
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
        registry({ 'agent-key/agent-1': 'resolved-agent-key' }),
        registry(),
      ),
    ).rejects.toThrow('API endpoint does not match its pinned activation');
    expect(connectMock).not.toHaveBeenCalled();
  });
});

describe('external agent server agents', () => {
  it('attaches an agent-key identity from the central store by alias', async () => {
    const store = freshStore();
    store.writeAgentConfig(
      'central',
      externalConfig({
        agent_key_ref: { provider: 'file', key: 'agent-key/agent-1' },
        keys: {
          public_key: 'ed25519:public',
          fingerprint: 'FP-1',
          private_key_ref: { provider: 'file', key: 'identity/FP-1/seed' },
        },
      }),
    );

    await attachExternalAgent(store, registry(), {
      name: 'central',
      configDir: store.identityDir('central'),
    });

    expect(store.readActivation('central')).toMatchObject({
      source: 'external',
      alias: 'central',
      configPath: store.agentPath('central'),
    });
    expect(connectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: 'resolved-agent-key',
        apiUrl: 'https://api.themolt.net',
      }),
    );
  });

  it('refuses a central identity without a daemon agent key', async () => {
    const store = freshStore();
    const oauthOnly = externalConfig();
    delete oauthOnly.agent_key_ref;
    store.writeAgentConfig('oauth-only', oauthOnly);

    await expect(
      attachExternalAgent(store, registry(), {
        name: 'oauth-only',
        configDir: store.identityDir('oauth-only'),
      }),
    ).rejects.toMatchObject({ code: 'unsupported_credential' });
    expect(connectMock).not.toHaveBeenCalled();
  });

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

  it('surfaces the safe agent-key rejection guidance from the SDK', async () => {
    const store = freshStore();
    const configDir = writeExternalConfig(externalConfig());
    connectMock.mockResolvedValueOnce({
      agents: {
        whoami: vi
          .fn()
          .mockRejectedValue(
            new AuthenticationError(
              'agent key rejected (401): re-provision the key.',
              { statusCode: 401 },
            ),
          ),
      },
    });

    await expect(
      attachExternalAgent(store, registry(), {
        name: 'rejected',
        configDir,
      }),
    ).rejects.toMatchObject({
      code: 'verification_failed',
      message: 'agent key rejected (401): re-provision the key.',
    });
    expect(store.readActivation('rejected')).toBeNull();
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
      subjectId: 'agent-1',
      publicKey: 'ed25519:public',
      fingerprint: 'FP-1',
    });
    expect(store.readAgentConfig('external')).toBeNull();
    expect(connectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: 'resolved-agent-key',
        apiUrl: 'https://api.themolt.net',
      }),
    );
  });

  it('rejects an OAuth-only external config', async () => {
    const store = freshStore();
    const oauthOnly = externalConfig();
    delete oauthOnly.agent_key_ref;
    const configDir = writeExternalConfig(oauthOnly);

    await expect(
      attachExternalAgent(store, registry(), {
        name: 'oauth-only',
        configDir,
      }),
    ).rejects.toMatchObject({ code: 'unsupported_credential' });
    expect(connectMock).not.toHaveBeenCalled();
    expect(store.readActivation('oauth-only')).toBeNull();
  });

  it('rejects attach-time subject mismatches', async () => {
    const store = freshStore();
    const configDir = writeExternalConfig(
      externalConfig({ subject_id: 'different' }),
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
    ['subject id', { subject_id: 'changed' }],
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

  it('accepts an Ory relink and refreshes rotated signing metadata', async () => {
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
          keys: {
            public_key: 'rotated-public',
            private_key: 'rotated-seed',
            fingerprint: 'ROTATED-FP',
          },
        }),
      ),
    );
    connectMock.mockResolvedValueOnce({
      agents: {
        whoami: vi.fn().mockResolvedValue({
          ...whoami,
          identityId: 'replacement-identity',
          publicKey: 'rotated-public',
          fingerprint: 'ROTATED-FP',
        }),
      },
    });

    await expect(
      verifyAgentActivation(store, 'external', registry(), registry()),
    ).resolves.toMatchObject({
      activation: {
        subjectId: 'agent-1',
        publicKey: 'rotated-public',
        fingerprint: 'ROTATED-FP',
      },
    });
    expect(store.readActivation('external')).toMatchObject({
      subjectId: 'agent-1',
      publicKey: 'rotated-public',
      fingerprint: 'ROTATED-FP',
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

describe.each(['managed', 'external'] as const)(
  '%s per-run team credentials',
  (source) => {
    it('verifies concurrent selections independently, refreshes keys and fails a selected slot without OAuth fallback', async () => {
      const store = freshStore();
      const config = externalConfig({
        agent_key_refs: {
          a: { provider: 'file', key: 'agent-key/agent-1/a' },
          b: { provider: 'file', key: 'agent-key/agent-1/b' },
        },
      });
      const values: Record<string, string> = {
        'agent-key/agent-1': 'fallback',
        'agent-key/agent-1/a': 'a',
        'agent-key/agent-1/b': 'b',
      };
      const providers = registry(values);
      connectMock.mockImplementation((options: SdkNode.ConnectOptions) =>
        Promise.resolve({
          agents: {
            whoami: () =>
              Promise.resolve({
                ...whoami,
                credentialBinding: {
                  bindingScope: 'team',
                  boundTeamId: options.agentKey?.replace('-rotated', ''),
                },
              }),
          },
        }),
      );
      if (source === 'managed') {
        store.writeAgentConfig('multi', config);
        store.writeActivation({
          alias: 'multi',
          source,
          subjectId: 'agent-1',
          publicKey: whoami.publicKey!,
          fingerprint: whoami.fingerprint!,
          createdAt: 't',
          apiUrl: config.endpoints.api,
          boundTeamId: 'a',
        });
      } else {
        await attachExternalAgent(store, providers, {
          name: 'multi',
          configDir: writeExternalConfig(config),
          teamId: 'a',
        });
      }
      const verify = (team?: string) =>
        verifyAgentActivation(
          store,
          'multi',
          providers,
          providers,
          undefined,
          undefined,
          team,
        );
      await expect(verify()).resolves.toMatchObject({ boundTeamId: 'a' });
      expect(connectMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ agentKey: 'a' }),
      );
      const [a, b] = await Promise.all([verify('a'), verify('b')]);
      expect([a.boundTeamId, b.boundTeamId]).toEqual(['a', 'b']);
      expect(store.readActivation('multi')?.boundTeamId).toBe('a');
      values['agent-key/agent-1/b'] = 'b-rotated';
      await expect(verify('b')).resolves.toMatchObject({ boundTeamId: 'b' });
      expect(connectMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ agentKey: 'b-rotated' }),
      );
      delete values['agent-key/agent-1/a'];
      connectMock.mockClear();
      await expect(verify('a')).rejects.toThrow('could not resolve');
      await expect(verify()).rejects.toThrow('could not resolve');
      expect(connectMock).not.toHaveBeenCalled();
      await expect(verify('b')).resolves.toMatchObject({ boundTeamId: 'b' });
    });

    it.each(['wrong-team', undefined])(
      'rejects a map slot resolving to binding %s',
      async (boundTeamId) => {
        const store = freshStore();
        const config = externalConfig({
          agent_key_ref: undefined,
          agent_key_refs: {
            a: { provider: 'file', key: 'agent-key/agent-1/a' },
          },
        });
        const providers = registry({ 'agent-key/agent-1/a': 'a' });
        connectMock.mockResolvedValue({
          agents: {
            whoami: () =>
              Promise.resolve({
                ...whoami,
                ...(boundTeamId
                  ? { credentialBinding: { bindingScope: 'team', boundTeamId } }
                  : {}),
              }),
          },
        });
        if (source === 'managed') {
          store.writeAgentConfig('multi', config);
          store.writeActivation({
            alias: 'multi',
            source,
            subjectId: 'agent-1',
            publicKey: whoami.publicKey!,
            fingerprint: whoami.fingerprint!,
            createdAt: 't',
            apiUrl: config.endpoints.api,
            boundTeamId: 'a',
          });
          await expect(
            verifyAgentActivation(
              store,
              'multi',
              providers,
              providers,
              undefined,
              undefined,
              'a',
            ),
          ).rejects.toThrow('team binding');
        } else {
          await expect(
            attachExternalAgent(store, providers, {
              name: 'multi',
              configDir: writeExternalConfig(config),
              teamId: 'a',
            }),
          ).rejects.toThrow('team binding');
        }
      },
    );
  },
);
