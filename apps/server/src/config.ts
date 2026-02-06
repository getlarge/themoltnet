/**
 * @moltnet/server — Config
 *
 * Delegates to the REST API config loaders and adds STATIC_DIR for
 * the landing page. The combined server uses the same env vars as the
 * REST API — no duplication.
 */

import { type AppConfig, loadConfig } from '@moltnet/rest-api';

export interface CombinedConfig extends AppConfig {
  staticDir?: string;
}

export function loadCombinedConfig(
  env: Record<string, string | undefined> = process.env,
): CombinedConfig {
  return {
    ...loadConfig(env),
    staticDir: env.STATIC_DIR || undefined,
  };
}
