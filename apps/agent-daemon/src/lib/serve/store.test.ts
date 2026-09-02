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

import { resolveServeRoot, ServeStore, ServeStoreError } from './store.js';

const roots: string[] = [];

function freshStore(): ServeStore {
  const root = mkdtempSync(join(tmpdir(), 'serve-store-'));
  roots.push(root);
  return new ServeStore(join(root, 'moltnet')).ensure();
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('resolveServeRoot', () => {
  it('prefers the explicit root, then XDG, then ~/.config', () => {
    expect(resolveServeRoot({ root: '/explicit' })).toBe('/explicit');
    expect(resolveServeRoot({ xdgConfigHome: '/xdg' })).toBe('/xdg/moltnet');
    expect(resolveServeRoot({})).toMatch(/\.config\/moltnet$/);
  });
});

describe('ServeStore', () => {
  it('creates the layout with owner-only permissions', () => {
    const store = freshStore();
    for (const dir of [
      store.root,
      store.agentsDir,
      store.runsDir,
      store.secretsDir,
    ]) {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
  });

  it('round-trips the versioned activation state', () => {
    const store = freshStore();
    expect(store.readServeState()).toEqual({
      version: 1,
      pendingRegistrations: {},
      activations: {},
    });
    store.writeServeState({
      version: 1,
      activations: {},
      pendingRegistrations: {},
    });
    expect(store.readServeState().activations).toEqual({});
    expect(statSync(join(store.root, 'serve.json')).mode & 0o777).toBe(0o600);
  });

  it('rejects the obsolete durable pairing format', () => {
    const store = freshStore();
    writeFileSync(
      join(store.root, 'serve.json'),
      JSON.stringify({
        version: 1,
        pendingRegistrations: {},
        activations: {},
        pairedOrigins: {
          'https://console.themolt.net': { tokenHash: 'obsolete' },
        },
      }),
    );

    expect(() => store.readServeState()).toThrow('obsolete pairing format');
  });

  it('does not treat unreadable state as missing state', () => {
    const store = freshStore();
    mkdirSync(join(store.root, 'serve.json'));

    expect(() => store.readServeState()).toThrow('could not read state');
  });

  it('does not include corrupt state contents in parse errors', () => {
    const store = freshStore();
    writeFileSync(
      join(store.root, 'serve.json'),
      '{"client_secret":"do-not-leak",}',
    );

    expect(() => store.readServeState()).toThrow('corrupt JSON at');
    try {
      store.readServeState();
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
    expect(raw).not.toContain('agentName');
    expect(raw).not.toContain('agentKeyRef');
    expect(raw).not.toContain('privateKeyRef');
    expect(raw).not.toContain('secret-value');
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
      join(store.root, 'serve.json'),
      JSON.stringify({
        version: 1,
        pendingRegistrations: {},
        activations: { broken: activation },
      }),
    );

    expect(() => store.readServeState()).toThrow(
      'not a valid version 1 activation',
    );
  });

  it('rejects invalid names for agents, providers, and run ids', () => {
    const store = freshStore();
    expect(() => store.readAgentConfig('../escape')).toThrow(ServeStoreError);
    expect(() =>
      store.writeProviders({
        'bad id': { api: 'a', baseUrl: 'b', envName: 'C', models: ['m'] },
      }),
    ).toThrow(ServeStoreError);
    expect(() =>
      store.writeProviders({
        Foo: {
          api: 'a',
          baseUrl: 'b',
          envName: 'MOLTNET_PROVIDER_FOO_API_KEY',
          models: ['m'],
        },
      }),
    ).toThrow(ServeStoreError);
    expect(() =>
      store.writeProviders({
        foo_bar: {
          api: 'a',
          baseUrl: 'b',
          envName: 'MOLTNET_PROVIDER_FOO_BAR_API_KEY',
          models: ['m'],
        },
      }),
    ).toThrow(ServeStoreError);
    expect(() =>
      store.writeProviders({
        unsafe: {
          api: 'a',
          baseUrl: 'b',
          envName: 'NODE_OPTIONS',
          models: ['m'],
        },
      }),
    ).toThrow(ServeStoreError);
    expect(() => store.runDir('../escape')).toThrow(ServeStoreError);
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

    expect(() => store.readProviders()).toThrow(ServeStoreError);
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
});
