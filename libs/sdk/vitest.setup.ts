import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach } from 'vitest';

/**
 * Start every SDK test from the environment CI has: no `MOLTNET_*` variables,
 * and no way to reach the developer's real MoltNet store.
 *
 * The SDK reads `MOLTNET_*` for credentials path, client id/secret, API URL and
 * more. Anyone running these tests inside an activated MoltNet session — a
 * LeGreffier editor session, or a daemon agent — has those exported, and they
 * leak into tests that assume a clean environment. `connect()`'s activation
 * guard, for instance, rejects an explicit `configDir` that disagrees with an
 * ambient `MOLTNET_CREDENTIALS_PATH`, so `node-secret-provider.test.ts` fails
 * locally while passing in CI, where no such variable exists.
 *
 * Clearing the prefix alone left HOME real, so a test resolving the default
 * store read and wrote the developer's `~/.config/moltnet` and its
 * `themolt.net` keyring namespace. Each test therefore also gets a temporary
 * HOME, a temporary store selected with `MOLTNET_HOME`, and a
 * `MOLTNET_DEFAULT_STORE_ROOT` naming an unused directory, so no test store is
 * the default store and none uses `themolt.net`. Tests that need a variable
 * set it themselves; this hook runs before their own `beforeEach`.
 */
const scratch = mkdtempSync(join(tmpdir(), 'moltnet-sdk-test-env-'));
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
