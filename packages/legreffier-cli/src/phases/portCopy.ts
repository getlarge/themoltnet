import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type { MoltNetConfig } from '@themoltnet/sdk';

import { fileExists } from './portValidate.js';

export interface PortCopyResult {
  /** Absolute path of each file written, in copy order. */
  copied: string[];
  /** Warnings for optional files that were not present in the source. */
  warnings: string[];
}

/**
 * Copy private material from a source `.moltnet/<agent>/` into the target.
 *
 * Copies:
 *  - `moltnet.json` (0600) — will later be rewritten in P3 with absolute paths
 *  - GitHub App PEM (0600) — at `<sourceDir>/<appSlug>.pem` by convention
 *  - SSH private key (0600) and public key (0644)
 *  - `allowed_signers` if present (0644) — optional, warning only
 *
 * Assumes `runPortValidatePhase` has been run and `canProceed` was true,
 * so required fields and files are known to exist.
 */
export async function runPortCopyPhase(opts: {
  sourceDir: string;
  targetDir: string;
  config: MoltNetConfig;
}): Promise<PortCopyResult> {
  const { sourceDir, targetDir, config } = opts;
  const copied: string[] = [];
  const warnings: string[] = [];

  await mkdir(targetDir, { recursive: true });

  // 1. moltnet.json
  const targetConfig = join(targetDir, 'moltnet.json');
  await copyFile(join(sourceDir, 'moltnet.json'), targetConfig);
  await chmod(targetConfig, 0o600);
  copied.push(targetConfig);

  // 2. GitHub App PEM
  if (!config.github?.private_key_path) {
    throw new Error('github.private_key_path missing — run portValidate first');
  }
  const pemFilename = basename(config.github.private_key_path);
  const targetPem = join(targetDir, pemFilename);
  await copyFile(config.github.private_key_path, targetPem);
  await chmod(targetPem, 0o600);
  copied.push(targetPem);

  // 3. SSH keys (private + public). Preserve the relative layout under ssh/.
  if (!config.ssh?.private_key_path || !config.ssh?.public_key_path) {
    throw new Error('ssh key paths missing — run portValidate first');
  }
  const sshDir = join(targetDir, 'ssh');
  await mkdir(sshDir, { recursive: true });

  const targetSshPriv = join(sshDir, basename(config.ssh.private_key_path));
  await copyFile(config.ssh.private_key_path, targetSshPriv);
  await chmod(targetSshPriv, 0o600);
  copied.push(targetSshPriv);

  const targetSshPub = join(sshDir, basename(config.ssh.public_key_path));
  await copyFile(config.ssh.public_key_path, targetSshPub);
  await chmod(targetSshPub, 0o644);
  copied.push(targetSshPub);

  // 4. allowed_signers — optional. Lives alongside ssh keys by convention.
  const sourceAllowed = join(
    dirname(config.ssh.private_key_path),
    'allowed_signers',
  );
  if (await fileExists(sourceAllowed)) {
    const targetAllowed = join(sshDir, 'allowed_signers');
    await copyFile(sourceAllowed, targetAllowed);
    await chmod(targetAllowed, 0o644);
    copied.push(targetAllowed);
  } else {
    warnings.push(
      `allowed_signers not found at ${sourceAllowed} — skipping (optional)`,
    );
  }

  return { copied, warnings };
}
