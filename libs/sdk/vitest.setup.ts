import { beforeEach } from 'vitest';

/**
 * Start every SDK test from the environment CI has: no `MOLTNET_*` variables.
 *
 * The SDK reads `MOLTNET_*` for credentials path, client id/secret, API URL and
 * more. Anyone running these tests inside an activated MoltNet session — a
 * LeGreffier editor session, or a daemon agent — has those exported, and they
 * leak into tests that assume a clean environment. `connect()`'s activation
 * guard, for instance, rejects an explicit `configDir` that disagrees with an
 * ambient `MOLTNET_CREDENTIALS_PATH`, so `node-secret-provider.test.ts` fails
 * locally while passing in CI, where no such variable exists.
 *
 * That makes the failure invisible to CI by construction: it is not a coverage
 * gap, it is the test inheriting developer state. Clearing the prefix here fixes
 * the whole suite at once. Tests that need a variable set it themselves, and
 * this hook runs before their own `beforeEach`.
 */
beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('MOLTNET_')) {
      delete process.env[key];
    }
  }
});
