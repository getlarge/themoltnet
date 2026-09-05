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
  legacyXdgAgentServerRoot,
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

  it('still reports the legacy XDG root so it can be adopted', () => {
    expect(legacyXdgAgentServerRoot('/xdg')).toBe(join('/xdg', 'moltnet'));
    expect(legacyXdgAgentServerRoot('')).toBeNull();
  });

  // The parameter is gone entirely rather than ignored, so XDG cannot reach
  // root resolution at all — a structural guarantee, not a runtime assertion.
  it('takes no XDG input', () => {
    expect(resolveAgentServerRoot({})).toMatch(/\.config\/moltnet$/);
  });
});

describe('legacy layout migration', () => {
  function stagedRoots(): { legacy: string; current: string } {
    const base = mkdtempSync(join(tmpdir(), 'agent-server-migrate-'));
    roots.push(base);
    return {
      legacy: join(base, 'xdg', 'moltnet'),
      current: join(base, 'home'),
    };
  }

  it('adopts state left at the pre-1834 XDG root', () => {
    const { legacy, current } = stagedRoots();
    mkdirSync(join(legacy, 'identities', 'alpha'), { recursive: true });
    writeFileSync(
      join(legacy, 'identities', 'alpha', 'moltnet.json'),
      JSON.stringify({ identity_id: 'a' }),
    );
    const store = new AgentServerStore(current).ensure({
      legacyXdgConfigHome: join(legacy, '..'),
    });

    // Aligning the root without adopting would leave an upgraded daemon
    // reporting zero managed agents while its state sat untouched elsewhere.
    expect(store.readAgentConfig('alpha')).toMatchObject({ identity_id: 'a' });
    expect(existsSync(legacy)).toBe(false);
  });

  it('refuses to guess when both roots hold state', () => {
    const { legacy, current } = stagedRoots();
    for (const root of [legacy, current]) {
      mkdirSync(join(root, 'identities', 'alpha'), { recursive: true });
      writeFileSync(
        join(root, 'identities', 'alpha', 'moltnet.json'),
        JSON.stringify({ identity_id: root }),
      );
    }
    expect(() =>
      new AgentServerStore(current).ensure({
        legacyXdgConfigHome: join(legacy, '..'),
      }),
    ).toThrow(/state exists at both/);
  });

  it('migrates agents/<alias>.json to identities/<alias>/moltnet.json', () => {
    const base = mkdtempSync(join(tmpdir(), 'agent-server-agents-'));
    roots.push(base);
    const root = join(base, 'moltnet');
    mkdirSync(join(root, 'agents'), { recursive: true });
    writeFileSync(
      join(root, 'agents', 'alpha.json'),
      JSON.stringify({ identity_id: 'alpha-id' }),
    );

    const store = new AgentServerStore(root).ensure();

    expect(store.readAgentConfig('alpha')).toMatchObject({
      identity_id: 'alpha-id',
    });
    expect(existsSync(join(root, 'agents', 'alpha.json'))).toBe(false);
  });

  it('never clobbers an existing managed document', () => {
    const base = mkdtempSync(join(tmpdir(), 'agent-server-agents-'));
    roots.push(base);
    const root = join(base, 'moltnet');
    mkdirSync(join(root, 'agents'), { recursive: true });
    writeFileSync(
      join(root, 'agents', 'alpha.json'),
      JSON.stringify({ identity_id: 'stale' }),
    );
    mkdirSync(join(root, 'identities', 'alpha'), { recursive: true });
    writeFileSync(
      join(root, 'identities', 'alpha', 'moltnet.json'),
      JSON.stringify({ identity_id: 'authoritative' }),
    );

    const store = new AgentServerStore(root).ensure();

    expect(store.readAgentConfig('alpha')).toMatchObject({
      identity_id: 'authoritative',
    });
    // Left in place for inspection rather than silently discarded.
    expect(existsSync(join(root, 'agents', 'alpha.json'))).toBe(true);
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
      version: 1,
      pendingRegistrations: {},
      activations: {},
    });
    store.writeAgentServerState({
      version: 1,
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
        version: 1,
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
      identityId: 'id',
      publicKey: 'pk',
      fingerprint: 'fp',
      createdAt: 't',
      apiUrl: 'https://api.example',
    });

    expect(store.hasPendingRegistration('agent')).toBe(false);
    expect(store.readActivation('agent')).toMatchObject({ identityId: 'id' });
  });

  it('stores managed agents as canonical configs and lists activations sorted', () => {
    const store = freshStore();
    store.writeAgentConfig('zeta', {
      identity_id: 'id-z',
      registered_at: 't',
      agent_key_ref: { provider: 'file', key: 'agent-key/id-z' },
      keys: {
        public_key: 'pk-z',
        fingerprint: 'fp-z',
        private_key_ref: { provider: 'file', key: 'identity/fp-z/seed' },
      },
      endpoints: { api: 'https://api.example', mcp: 'https://mcp.example' },
    });
    const base = {
      source: 'managed' as const,
      identityId: 'id',
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
      identity_id: 'id-z',
      agent_key_ref: { provider: 'file', key: 'agent-key/id-z' },
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

  it('uses the shared versioned selector without consulting repository state', () => {
    const store = freshStore();
    store.writeAgentConfig('first', {
      identity_id: 'id-first',
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
      identity_id: 'id-second',
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
      identityId: 'id',
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
  ])('rejects malformed version 1 activation %s', (_case, change) => {
    const store = freshStore();
    const activation = {
      alias: 'broken',
      identityId: 'id',
      publicKey: 'pk',
      fingerprint: 'fp',
      createdAt: 't',
      ...change,
    };
    writeFileSync(
      join(store.root, 'agent-server.json'),
      JSON.stringify({
        version: 1,
        pendingRegistrations: {},
        activations: { broken: activation },
      }),
    );

    expect(() => store.readAgentServerState()).toThrow(
      'not a valid version 1 activation',
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
    store.writeAgentConfig('alpha', { identity_id: 'a' } as never);
    store.writeAgentConfig('beta', { identity_id: 'b' } as never);
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
