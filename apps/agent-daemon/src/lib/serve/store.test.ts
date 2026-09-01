import { mkdtempSync, rmSync, statSync } from 'node:fs';
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

  it('round-trips serve state and defaults to empty pairings', () => {
    const store = freshStore();
    expect(store.readServeState()).toEqual({ version: 1, pairedOrigins: {} });
    store.writeServeState({
      version: 1,
      pairedOrigins: {
        'https://console.themolt.net': { tokenHash: 'ab', createdAt: 't' },
      },
    });
    expect(
      store.readServeState().pairedOrigins['https://console.themolt.net'],
    ).toEqual({ tokenHash: 'ab', createdAt: 't' });
    expect(statSync(join(store.root, 'serve.json')).mode & 0o777).toBe(0o600);
  });

  it('round-trips agents and lists them sorted', () => {
    const store = freshStore();
    const base = {
      version: 1 as const,
      kind: 'external' as const,
      configDir: '/repo/.moltnet/x',
      createdAt: 't',
    };
    store.writeAgent({ ...base, agentName: 'zeta' });
    store.writeAgent({ ...base, agentName: 'alpha' });
    expect(store.listAgents().map((entry) => entry.agentName)).toEqual([
      'alpha',
      'zeta',
    ]);
    expect(store.readAgent('missing')).toBeNull();
  });

  it('rejects invalid names for agents, providers, and run ids', () => {
    const store = freshStore();
    expect(() => store.readAgent('../escape')).toThrow(ServeStoreError);
    expect(() =>
      store.writeProviders({
        'bad id': { api: 'a', baseUrl: 'b', envName: 'C', models: ['m'] },
      }),
    ).toThrow(ServeStoreError);
    expect(() => store.runDir('../escape')).toThrow(ServeStoreError);
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
});
