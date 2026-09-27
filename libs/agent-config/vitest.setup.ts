import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach } from 'vitest';

/**
 * Start every agent-config test with no `MOLTNET_*` variables and no way to
 * reach the developer's real MoltNet store.
 *
 * These readers resolve the store root from `MOLTNET_HOME`, then HOME. Run
 * from an activated session, the exported `MOLTNET_HOME` (or a real HOME)
 * pointed tests at the developer's `~/.config/moltnet` and its `themolt.net`
 * keyring namespace. Each test gets a temporary HOME, a temporary store
 * selected with `MOLTNET_HOME`, and a `MOLTNET_DEFAULT_STORE_ROOT` naming an
 * unused directory, so no test store is the default store. Tests that need a
 * variable set it themselves; this hook runs before their own `beforeEach`.
 */
const scratch = mkdtempSync(join(tmpdir(), 'moltnet-agent-config-test-env-'));
const home = join(scratch, 'home');
const store = join(home, '.config', 'moltnet');
const unusedDefaultStore = join(scratch, 'default-store-never-used');
mkdirSync(store, { recursive: true });
mkdirSync(unusedDefaultStore, { recursive: true });

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('MOLTNET_')) {
      delete process.env[key];
    }
  }
  process.env.HOME = home;
  process.env.MOLTNET_HOME = store;
  process.env.MOLTNET_DEFAULT_STORE_ROOT = unusedDefaultStore;
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});
