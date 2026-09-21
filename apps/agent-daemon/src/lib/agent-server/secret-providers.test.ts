import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { storeSecretService } from '@themoltnet/sdk/node';
import { afterEach, expect, it, vi } from 'vitest';

import { ConnectionSettingsStore } from './connection-settings.js';
import { createAgentServerSecretProviders } from './secret-providers.js';
import { AgentServerStore } from './store.js';

const values = vi.hoisted(() => new Map<string, string>());
vi.mock('@themoltnet/os-keyring', () => ({
  OSKeyringSecretProvider: class {
    name = 'os-keyring';
    capabilities = { read: true, write: true, delete: true };
    constructor(
      _platform: unknown,
      _loader: unknown,
      private service: string,
    ) {}
    read(key: string) {
      return Promise.resolve(values.get(`${this.service}/${key}`) ?? null);
    }
  },
  windowsKeyringTarget: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => {
  values.clear();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it.each(['default', 'isolated'])(
  'keeps %s keyring references readable after a connection change',
  async (selection) => {
    const home = mkdtempSync(join(tmpdir(), 'server-secrets-'));
    roots.push(home);
    vi.stubEnv('HOME', home);
    const root = join(
      home,
      selection === 'default' ? '.config/moltnet' : 'isolated',
    );
    const settings = new ConnectionSettingsStore(root);
    values.set(
      `${storeSecretService({ root, home })}/fixture`,
      'secret-sentinel',
    );
    settings.save({ apiUrl: 'https://api.example' });
    const store = new AgentServerStore(settings.stateRoot()).ensure();
    expect(store.root).not.toBe(root);
    const providers = createAgentServerSecretProviders(settings, store);
    for (const registry of [
      providers.secretProviders,
      providers.externalSecretProviders,
    ]) {
      await expect(
        registry.resolve({ provider: 'os-keyring', key: 'fixture' }),
      ).resolves.toBe('secret-sentinel');
    }
    await providers.secrets.write('fixture', 'file-sentinel');
    await expect(
      providers.secretProviders.resolve({ provider: 'file', key: 'fixture' }),
    ).resolves.toBe('file-sentinel');
    expect(
      providers.externalSecretProviders.get('file')?.capabilities.write,
    ).toBe(false);
  },
);
