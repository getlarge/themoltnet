import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AgentServerStore,
  AgentServerStoreError,
  assertStoreName,
  resolveAgentServerRoot,
} from './store.js';

const roots: string[] = [];

function freshStore(): AgentServerStore {
  const root = mkdtempSync(join(tmpdir(), 'agent-server-store-'));
  roots.push(root);
  return new AgentServerStore(join(root, 'moltnet')).ensure();
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('resolveAgentServerRoot', () => {
  it('uses the explicit root, else ~/.config/moltnet', () => {
    expect(resolveAgentServerRoot({ root: '/explicit' })).toBe('/explicit');
    expect(resolveAgentServerRoot({})).toMatch(/\.config\/moltnet$/);
  });

  // The parameter is gone entirely rather than ignored, so XDG cannot reach
  // root resolution at all — a structural guarantee, not a runtime assertion.
  it('takes no XDG input', () => {
    expect(resolveAgentServerRoot({})).toMatch(/\.config\/moltnet$/);
  });
});

describe('AgentServerStore', () => {
  it('creates the layout with owner-only permissions', () => {
    const store = freshStore();
    for (const dir of [
      store.root,
      store.identitiesDir,
      store.runsDir,
      store.secretsDir,
    ]) {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
  });

  it('round-trips the versioned activation state', () => {
    const store = freshStore();
    expect(store.readAgentServerState()).toEqual({
      version: 2,
      pendingRegistrations: {},
      activations: {},
    });
    store.writeAgentServerState({
      version: 2,
      activations: {},
      pendingRegistrations: {},
    });
    expect(store.readAgentServerState().activations).toEqual({});
    expect(statSync(join(store.root, 'agent-server.json')).mode & 0o777).toBe(
      0o600,
    );
  });

  it('rejects the obsolete durable pairing format', () => {
    const store = freshStore();
    writeFileSync(
      join(store.root, 'agent-server.json'),
      JSON.stringify({
        version: 2,
        pendingRegistrations: {},
        activations: {},
        pairedOrigins: {
          'https://console.themolt.net': { tokenHash: 'obsolete' },
        },
      }),
    );

    expect(() => store.readAgentServerState()).toThrow(
      'obsolete pairing format',
    );
  });

  it('does not treat unreadable state as missing state', () => {
    const store = freshStore();
    mkdirSync(join(store.root, 'agent-server.json'));

    expect(() => store.readAgentServerState()).toThrow('could not read state');
  });

  it('does not include corrupt state contents in parse errors', () => {
    const store = freshStore();
    writeFileSync(
      join(store.root, 'agent-server.json'),
      '{"client_secret":"do-not-leak",}',
    );

    expect(() => store.readAgentServerState()).toThrow('corrupt JSON at');
    try {
      store.readAgentServerState();
    } catch (error) {
      expect((error as Error).message).not.toContain('do-not-leak');
    }
  });

  it('persists and completes durable registration reservations', () => {
    const store = freshStore();
    store.reserveRegistration('agent', 'https://api.example');
    expect(store.hasPendingRegistration('agent')).toBe(true);

    store.writeActivation({
      alias: 'agent',
      source: 'managed',
      subjectId: 'agent-1',
      publicKey: 'pk',
      fingerprint: 'fp',
      createdAt: 't',
      apiUrl: 'https://api.example',
    });

    expect(store.hasPendingRegistration('agent')).toBe(false);
    expect(store.readActivation('agent')).toMatchObject({
      subjectId: 'agent-1',
    });
  });

  it('stores managed agents as canonical configs and lists activations sorted', () => {
    const store = freshStore();
    store.writeAgentConfig('zeta', {
      subject_id: 'agent-z',
      subject_type: 'agent',
      registered_at: 't',
      agent_key_ref: { provider: 'file', key: 'agent-key/agent-z' },
      keys: {
        public_key: 'pk-z',
        fingerprint: 'fp-z',
        private_key_ref: { provider: 'file', key: 'identity/fp-z/seed' },
      },
      endpoints: { api: 'https://api.example', mcp: 'https://mcp.example' },
    });
    const base = {
      source: 'managed' as const,
      subjectId: 'agent-1',
      publicKey: 'pk',
      fingerprint: 'fp',
      createdAt: 't',
      apiUrl: 'https://api.example',
    };
    store.writeActivation({ ...base, alias: 'zeta' });
    store.writeActivation({ ...base, alias: 'alpha' });

    expect(
      store.listActivations().map((activation) => activation.alias),
    ).toEqual(['alpha', 'zeta']);
    expect(store.readActivation('missing')).toBeNull();
    expect(store.readAgentConfig('zeta')).toMatchObject({
      subject_id: 'agent-z',
      subject_type: 'agent',
      agent_key_ref: { provider: 'file', key: 'agent-key/agent-z' },
    });

    const raw = readFileSync(store.agentPath('zeta'), 'utf8');
    expect(store.agentPath('zeta')).toBe(
      join(store.root, 'identities', 'zeta', 'moltnet.json'),
    );
    expect(raw).not.toContain('agentName');
    expect(raw).not.toContain('agentKeyRef');
    expect(raw).not.toContain('privateKeyRef');
    expect(raw).not.toContain('secret-value');
  });

  it('lists central identity directories in stable order', () => {
    const store = freshStore();
    mkdirSync(store.identityDir('zeta'));
    mkdirSync(store.identityDir('alpha'));
    mkdirSync(join(store.identitiesDir, 'not an identity'));

    expect(store.listIdentityAliases()).toEqual(['alpha', 'zeta']);
  });

  it('uses the shared versioned selector without consulting repository state', () => {
    const store = freshStore();
    store.writeAgentConfig('first', {
      subject_id: 'agent-first',
      subject_type: 'agent',
      registered_at: 't',
      oauth2: {
        client_id: 'client-first',
        client_secret_ref: { provider: 'file', key: 'oauth2/id-first' },
      },
      keys: {
        public_key: 'pk',
        fingerprint: 'fp',
        private_key_ref: { provider: 'file', key: 'identity/fp/seed' },
      },
      endpoints: { api: 'https://api.example', mcp: 'https://mcp.example' },
    });
    store.writeAgentConfig('second', {
      subject_id: 'agent-second',
      subject_type: 'agent',
      registered_at: 't',
      oauth2: {
        client_id: 'client-second',
        client_secret_ref: { provider: 'file', key: 'oauth2/id-second' },
      },
      keys: {
        public_key: 'pk',
        fingerprint: 'fp',
        private_key_ref: { provider: 'file', key: 'identity/fp/seed' },
      },
      endpoints: { api: 'https://api.example', mcp: 'https://mcp.example' },
    });

    expect(store.readIdentitySelector()).toEqual({
      version: 1,
      default_identity: 'first',
    });
    expect(store.resolveIdentityAlias(undefined, 'second')).toBe('second');
    expect(store.resolveIdentityAlias()).toBe('first');
  });

  it('keeps external paths only in activation metadata', () => {
    const store = freshStore();
    store.writeActivation({
      alias: 'external',
      source: 'external',
      subjectId: 'agent-1',
      publicKey: 'pk',
      fingerprint: 'fp',
      configPath: '/repo/.moltnet/external/moltnet.json',
      configApiUrl: 'https://api.config',
      apiUrl: 'https://api.override',
      createdAt: 't',
    });

    expect(store.readActivation('external')).toMatchObject({
      configPath: '/repo/.moltnet/external/moltnet.json',
      apiUrl: 'https://api.override',
    });
    expect(store.readAgentConfig('external')).toBeNull();
  });

  it.each([
    ['managed API', { source: 'managed' }],
    [
      'managed/external union',
      {
        source: 'managed',
        apiUrl: 'https://api.example',
        configPath: '/repo/.moltnet/a/moltnet.json',
        configApiUrl: 'https://api.example',
      },
    ],
    [
      'external config path',
      { source: 'external', configApiUrl: 'https://api.example' },
    ],
    [
      'external config API',
      {
        source: 'external',
        configPath: '/repo/.moltnet/a/moltnet.json',
      },
    ],
    ['source', { source: 'unknown', apiUrl: 'https://api.example' }],
    [
      'alias/key agreement',
      { source: 'managed', alias: 'other', apiUrl: 'https://api.example' },
    ],
  ])('rejects malformed version 2 activation %s', (_case, change) => {
    const store = freshStore();
    const activation = {
      alias: 'broken',
      subjectId: 'agent-1',
      publicKey: 'pk',
      fingerprint: 'fp',
      createdAt: 't',
      ...change,
    };
    writeFileSync(
      join(store.root, 'agent-server.json'),
      JSON.stringify({
        version: 2,
        pendingRegistrations: {},
        activations: { broken: activation },
      }),
    );

    expect(() => store.readAgentServerState()).toThrow(
      'not a valid version 2 activation',
    );
  });

  it('rejects invalid names for agents, providers, and run ids', () => {
    const store = freshStore();
    expect(() => store.readAgentConfig('../escape')).toThrow(
      AgentServerStoreError,
    );
    expect(() =>
      store.writeProviders({
        'bad id': { api: 'a', baseUrl: 'b', envName: 'C', models: ['m'] },
      }),
    ).toThrow(AgentServerStoreError);
    expect(() =>
      store.writeProviders({
        Foo: {
          api: 'a',
          baseUrl: 'b',
          envName: 'MOLTNET_PROVIDER_FOO_API_KEY',
          models: ['m'],
        },
      }),
    ).toThrow(AgentServerStoreError);
    expect(() =>
      store.writeProviders({
        foo_bar: {
          api: 'a',
          baseUrl: 'b',
          envName: 'MOLTNET_PROVIDER_FOO_BAR_API_KEY',
          models: ['m'],
        },
      }),
    ).toThrow(AgentServerStoreError);
    expect(() =>
      store.writeProviders({
        unsafe: {
          api: 'a',
          baseUrl: 'b',
          envName: 'NODE_OPTIONS',
          models: ['m'],
        },
      }),
    ).toThrow(AgentServerStoreError);
    expect(() => store.runDir('../escape')).toThrow(AgentServerStoreError);
  });

  it.runIf(process.platform !== 'win32')(
    'rejects run directories that resolve outside the runs store',
    () => {
      const store = freshStore();
      const outside = join(store.root, 'outside');
      mkdirSync(outside);
      const { dir } = store.createRunDir('run-1');
      expect(store.resolveRunLogPath('run-1')).toBe(
        join(realpathSync(dir), 'daemon.log'),
      );
      rmSync(dir, { recursive: true });
      symlinkSync(outside, dir);

      expect(() => store.resolveRunLogPath('run-1')).toThrow(
        'run directory escapes its store',
      );
    },
  );

  it('rejects run log links before the SSE reader opens them', () => {
    const store = freshStore();
    const outside = join(store.root, 'outside');
    mkdirSync(outside);
    const { logPath } = store.createRunDir('run-1');
    symlinkSync(
      outside,
      logPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(() => store.resolveRunLogPath('run-1')).toThrow(
      'run log must not be a symbolic link',
    );
  });

  it('revalidates provider env names loaded from disk', () => {
    const store = freshStore();
    writeFileSync(
      join(store.root, 'providers.json'),
      JSON.stringify({
        unsafe: {
          api: 'a',
          baseUrl: 'b',
          envName: 'NODE_OPTIONS',
          models: ['m'],
        },
      }),
    );

    expect(() => store.readProviders()).toThrow(AgentServerStoreError);
  });

  it('round-trips runs through their run directories', () => {
    const store = freshStore();
    store.createRunDir('run-1');
    store.writeRun({
      id: 'run-1',
      agent: 'a',
      teamId: 'team',
      profiles: ['p'],
      taskTypes: ['freeform'],
      mode: 'poll',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
    });
    expect(store.readRun('run-1')?.status).toBe('running');
    expect(store.listRuns()).toHaveLength(1);
  });

  it('retains only completed run artifacts inside count, age, and byte budgets', () => {
    const store = freshStore();
    const writeRun = (
      id: string,
      status: 'running' | 'exited',
      startedAt: string,
      bytes: number,
    ) => {
      const { logPath } = store.createRunDir(id);
      store.writeRun({
        id,
        agent: 'agent',
        teamId: 'team',
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
        status,
        startedAt,
        ...(status === 'exited' ? { endedAt: startedAt, exitCode: 0 } : {}),
      });
      writeFileSync(logPath, 'x'.repeat(bytes));
    };
    writeRun('old', 'exited', '2025-01-01T00:00:00Z', 10);
    writeRun('large', 'exited', '2026-01-02T00:00:00Z', 2_000);
    writeRun('recent', 'exited', '2026-01-03T00:00:00Z', 10);
    writeRun('active', 'running', '2025-01-01T00:00:00Z', 2_000);

    const removed = store.pruneCompletedRuns({
      maxCount: 2,
      maxAgeMs: 7 * 24 * 60 * 60 * 1_000,
      maxBytes: 1_000,
      now: new Date('2026-01-04T00:00:00Z'),
    });

    expect(removed.sort()).toEqual(['large', 'old']);
    expect(existsSync(store.runDir('recent'))).toBe(true);
    expect(existsSync(store.runDir('active'))).toBe(true);
  });

  it('clears the persisted default when the identity it names is removed', () => {
    const store = freshStore();
    store.ensure();
    store.writeAgentConfig('alpha', {
      subject_id: 'a',
      subject_type: 'agent',
    } as never);
    store.writeAgentConfig('beta', {
      subject_id: 'b',
      subject_type: 'agent',
    } as never);
    store.writeIdentitySelector('alpha');
    expect(store.readIdentitySelector()?.default_identity).toBe('alpha');

    // Removing a non-default identity must leave the selector alone.
    store.removeAgentConfig('beta');
    expect(store.readIdentitySelector()?.default_identity).toBe('alpha');

    // Removing the default must clear it: a selector naming a deleted alias
    // makes resolution succeed on a dangling identity and surface as a
    // generic "not found".
    store.removeAgentConfig('alpha');
    expect(store.readIdentitySelector()?.default_identity).toBeUndefined();
  });
});

describe('identity alias grammar', () => {
  // The alias is a directory name in a store the Go CLI, the daemon and
  // @moltnet/agent-config all write, so the three grammars must accept exactly
  // the same strings. Mirrors agentNamePattern in apps/moltnet-cli.
  it('matches the Go CLI grammar', () => {
    for (const valid of ['agent', 'agent.v2', 'Agent_1', 'a', 'a'.repeat(63)]) {
      expect(() => assertStoreName('identity alias', valid)).not.toThrow();
    }
    for (const invalid of [
      '',
      '.hidden',
      '-leading',
      'a'.repeat(64),
      'has/slash',
      'has space',
    ]) {
      expect(() => assertStoreName('identity alias', invalid)).toThrow();
    }
  });
});
