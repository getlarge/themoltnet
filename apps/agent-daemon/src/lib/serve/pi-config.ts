/**
 * Generate a per-run Pi config directory (`PI_CODING_AGENT_DIR`) from the
 * serve provider registry. Nobody authors `models.json` by hand: the
 * registry rows become Pi custom providers whose API keys are env-var
 * references (`"$OLLAMA_API_KEY"`), and the actual values are injected only
 * into the child process environment at spawn time.
 *
 * The runtime profile still pins the exact provider/model pair; this file
 * only has to make that pair resolvable by Pi's ModelRegistry
 * (`resolveRuntimeProfileModel` fails closed on unknown pairs).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProvidersState } from './store.js';

export function writeRunPiConfig(
  piDir: string,
  providers: ProvidersState,
): void {
  const providerEntries = Object.fromEntries(
    Object.entries(providers).map(([id, provider]) => [
      id,
      {
        api: provider.api,
        ...(provider.apiKeyRef ? { apiKey: `$${provider.envName}` } : {}),
        baseUrl: provider.baseUrl,
        models: provider.models.map((model) => ({ id: model })),
      },
    ]),
  );
  writeFileSync(
    join(piDir, 'models.json'),
    `${JSON.stringify({ providers: providerEntries }, null, 2)}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(piDir, 'settings.json'),
    `${JSON.stringify({ enableInstallTelemetry: false }, null, 2)}\n`,
    { mode: 0o600 },
  );
}
