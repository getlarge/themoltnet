import { exportSSHKey as exportSSHKeyFromConfig } from '@moltnet/agent-config';

import { resolveIdentitySeed } from './credential-resolver.js';
import { readConfig } from './credentials.js';
import {
  createDefaultSecretProviderRegistry,
  type SecretProviderRegistry,
} from './secrets.js';

/**
 * Export the agent's SSH keypair, resolving `keys.private_key_ref` through
 * `secretProviders` (environment-only by default; pass
 * `createNodeSecretProviderRegistry()` from `@themoltnet/sdk/node` for
 * OS-keyring or file references).
 */
export async function exportSSHKey(opts?: {
  configDir?: string;
  outputDir?: string;
  secretProviders?: SecretProviderRegistry;
}): Promise<{ privatePath: string; publicPath: string }> {
  const config = await readConfig(opts?.configDir);
  if (!config) {
    throw new Error('No config found — run `moltnet register` first');
  }
  const privateKey = await resolveIdentitySeed(
    config,
    opts?.secretProviders ?? createDefaultSecretProviderRegistry(),
  );
  return exportSSHKeyFromConfig({
    configDir: opts?.configDir,
    outputDir: opts?.outputDir,
    privateKey,
  });
}
