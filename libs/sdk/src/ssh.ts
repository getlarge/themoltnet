import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { toSSHPrivateKey, toSSHPublicKey } from '@moltnet/crypto-service';

import {
  getConfigDir,
  getConfigPath,
  readConfig,
  updateConfigSection,
} from './credentials.js';

/**
 * Export the agent's Ed25519 key pair as OpenSSH key files.
 *
 * Reads the seed and public key from the MoltNet config, converts them
 * to SSH format, and writes `id_ed25519` (mode 0o600) and
 * `id_ed25519.pub` (mode 0o644) to the output directory.
 *
 * Updates the `ssh` section in `moltnet.json` with the written paths.
 */
export async function exportSSHKey(opts?: {
  configDir?: string;
  outputDir?: string;
}): Promise<{ privatePath: string; publicPath: string }> {
  const config = await readConfig(opts?.configDir);
  if (!config) {
    throw new Error(
      `No config found at ${getConfigPath(opts?.configDir)} — run \`moltnet register\` first`,
    );
  }

  const privateKeySSH = toSSHPrivateKey(config.keys.private_key);
  const publicKeySSH = toSSHPublicKey(config.keys.public_key);

  const outputDir = opts?.outputDir ?? join(getConfigDir(), 'ssh');
  await mkdir(outputDir, { recursive: true });

  const privatePath = join(outputDir, 'id_ed25519');
  const publicPath = join(outputDir, 'id_ed25519.pub');

  await writeFile(privatePath, privateKeySSH, { mode: 0o600 });
  await writeFile(publicPath, publicKeySSH, { mode: 0o644 });

  await updateConfigSection(
    'ssh',
    { private_key_path: privatePath, public_key_path: publicPath },
    opts?.configDir,
  );

  return { privatePath, publicPath };
}
