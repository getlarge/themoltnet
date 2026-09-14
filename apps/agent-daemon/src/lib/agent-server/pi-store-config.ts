/**
 * Materialise the Agent Server provider store as a Pi agent dir. Shared by
 * supervised runs (`runs.ts`) and direct `once`/`poll`/`drain` runs
 * (`pi-agent-dir.ts`) so both generate the same `models.json`.
 */
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { writePiConfig } from '@themoltnet/pi-runtime/pi-config';

import type { ProvidersState } from './store.js';
import { AgentServerStoreError } from './store.js';

/**
 * Write `models.json` + `settings.json` for the stored providers. API keys
 * appear only as `$MOLTNET_PROVIDER_<ID>_API_KEY` placeholders.
 */
export function writeStorePiConfig(
  piDir: string,
  providers: ProvidersState,
): void {
  writePiConfig({
    piDir,
    providers: Object.fromEntries(
      Object.entries(providers).map(([providerId, provider]) => [
        providerId,
        {
          api: provider.api,
          ...(provider.apiKeyRef
            ? { apiKeyEnvRef: `$${provider.envName}` }
            : {}),
          baseUrl: provider.baseUrl,
          models: provider.models,
        },
      ]),
    ),
  });
}

/**
 * Link a shared Pi `auth.json` into `piDir`. Pi lockfiles the target and
 * rotates tokens in place, so a link (never a copy) keeps one credential
 * document. A dangling link is fine — Pi treats a missing auth.json as "no
 * subscription auth". Failing to create the link is not: the run would start
 * with a connected subscription silently unavailable.
 */
export function linkPiAuth(
  authPath: string,
  piDir: string,
  symlinkImpl: typeof symlinkSync = symlinkSync,
): void {
  try {
    symlinkImpl(authPath, join(piDir, 'auth.json'));
  } catch (cause) {
    throw new AgentServerStoreError(
      'io_error',
      'could not link subscription credentials into the run',
      { cause },
    );
  }
}
