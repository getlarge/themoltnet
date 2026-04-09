import { basename, join } from 'node:path';

import { type MoltNetConfig, updateConfigSection } from '@themoltnet/sdk';

import { writeEnvFile } from '../env-file.js';
import { writeGitConfig } from '../github.js';
import { toEnvPrefix } from '../setup.js';

export interface PortRewriteResult {
  /** Final moltnet.json on disk in the target dir. */
  configPath: string;
  /** Rewritten absolute paths that were updated in moltnet.json. */
  rewrittenFields: string[];
  /** Path to the regenerated gitconfig. */
  gitConfigPath: string;
  /** Path to the regenerated env file (envDir/env). */
  envDir: string;
}

/**
 * Rewrite absolute paths in the ported `moltnet.json` so they point to
 * target locations, then regenerate the gitconfig and env file.
 *
 * Assumes `portCopy` already placed files at:
 *  - `<targetDir>/moltnet.json`
 *  - `<targetDir>/<appSlug>.pem`
 *  - `<targetDir>/ssh/<basename(ssh.private_key_path)>`
 *  - `<targetDir>/ssh/<basename(ssh.public_key_path)>`
 *
 * The ported config still has the *source* absolute paths — this phase
 * rewrites them to the target absolute paths, then writes the gitconfig
 * (which needs the new ssh key path) and the env file (which needs the
 * new PEM path).
 */
export async function runPortRewritePhase(opts: {
  targetDir: string;
  agentName: string;
  config: MoltNetConfig;
}): Promise<PortRewriteResult> {
  const { targetDir, agentName, config } = opts;

  if (!config.ssh || !config.git || !config.github) {
    throw new Error(
      'config missing ssh/git/github sections — run portValidate first',
    );
  }

  const newSshPriv = join(
    targetDir,
    'ssh',
    basename(config.ssh.private_key_path),
  );
  const newSshPub = join(
    targetDir,
    'ssh',
    basename(config.ssh.public_key_path),
  );
  const newPem = join(targetDir, basename(config.github.private_key_path));
  const newGitConfig = join(targetDir, 'gitconfig');

  // 1. Rewrite absolute paths in moltnet.json
  await updateConfigSection(
    'ssh',
    { private_key_path: newSshPriv, public_key_path: newSshPub },
    targetDir,
  );
  await updateConfigSection(
    'github',
    {
      app_id: config.github.app_id,
      app_slug: config.github.app_slug,
      installation_id: config.github.installation_id,
      private_key_path: newPem,
      ...(config.github.org ? { org: config.github.org } : {}),
    },
    targetDir,
  );
  await updateConfigSection(
    'git',
    {
      name: config.git.name,
      email: config.git.email,
      signing: config.git.signing,
      config_path: newGitConfig,
    },
    targetDir,
  );

  const rewrittenFields = [
    'ssh.private_key_path',
    'ssh.public_key_path',
    'github.private_key_path',
    'git.config_path',
  ];

  // 2. Regenerate gitconfig — signingkey must point to the new ssh public key.
  await writeGitConfig({
    configDir: targetDir,
    name: config.git.name,
    email: config.git.email,
    sshPublicKeyPath: newSshPub,
  });

  // 3. Regenerate env file with new PEM path
  const prefix = toEnvPrefix(agentName);
  await writeEnvFile({
    envDir: targetDir,
    agentName,
    prefix,
    clientId: config.oauth2.client_id,
    clientSecret: config.oauth2.client_secret,
    appId: config.github.app_id,
    pemPath: newPem,
    installationId: config.github.installation_id,
  });

  return {
    configPath: join(targetDir, 'moltnet.json'),
    rewrittenFields,
    gitConfigPath: newGitConfig,
    envDir: targetDir,
  };
}
