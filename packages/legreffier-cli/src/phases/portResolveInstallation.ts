import { findInstallationForOwner } from '@themoltnet/github-agent';
import { type MoltNetConfig, updateConfigSection } from '@themoltnet/sdk';

import { updateEnvVar } from '../env-file.js';

export type ResolveInstallationStatus =
  | 'updated'
  | 'unchanged'
  | 'not-installed'
  | 'skipped';

export interface PortResolveInstallationResult {
  status: ResolveInstallationStatus;
  message: string;
  /** The installation_id now in the config (may be the original or the new one). */
  installationId: string;
}

/**
 * Resolve the correct `installation_id` for the target owner.
 *
 * When porting a config across orgs the source `installation_id` is scoped
 * to the original account. This phase uses the App JWT to list all
 * installations and find the one matching the target owner, then updates
 * `moltnet.json` if it differs.
 */
export async function runPortResolveInstallationPhase(opts: {
  targetDir: string;
  config: MoltNetConfig;
  /** owner/repo of the target repo, e.g. "innovation-system/on-board-nx". */
  currentRepo?: string;
  /** Env var prefix for the agent, e.g. "LEGREFFIER". */
  envPrefix?: string;
}): Promise<PortResolveInstallationResult> {
  const { targetDir, config, currentRepo } = opts;

  if (!currentRepo) {
    return {
      status: 'skipped',
      message:
        'unable to determine target repo — skipping installation_id resolution',
      installationId: config.github?.installation_id ?? '',
    };
  }

  if (!config.github?.app_id || !config.github?.private_key_path) {
    return {
      status: 'skipped',
      message: 'github.app_id or private_key_path missing — cannot resolve',
      installationId: config.github?.installation_id ?? '',
    };
  }

  const targetOwner = currentRepo.split('/')[0];

  let result: { installationId: string } | null;
  try {
    result = await findInstallationForOwner({
      appId: config.github.app_id,
      privateKeyPath: config.github.private_key_path,
      owner: targetOwner,
    });
  } catch (err) {
    return {
      status: 'skipped',
      message: `could not list app installations: ${(err as Error).message}`,
      installationId: config.github?.installation_id ?? '',
    };
  }

  if (!result) {
    return {
      status: 'not-installed',
      message: `GitHub App is not installed on ${targetOwner} — install it first`,
      installationId: config.github?.installation_id ?? '',
    };
  }

  const oldId = config.github.installation_id;
  if (oldId === result.installationId) {
    return {
      status: 'unchanged',
      message: `installation_id ${oldId} already matches ${targetOwner}`,
      installationId: oldId,
    };
  }

  // Update moltnet.json with the resolved installation_id
  await updateConfigSection(
    'github',
    { installation_id: result.installationId },
    targetDir,
  );

  // Also patch the env file if a prefix was provided
  if (opts.envPrefix) {
    await updateEnvVar(
      targetDir,
      `${opts.envPrefix}_GITHUB_APP_INSTALLATION_ID`,
      result.installationId,
    );
  }

  return {
    status: 'updated',
    message: `installation_id updated: ${oldId || '(empty)'} → ${result.installationId} (${targetOwner})`,
    installationId: result.installationId,
  };
}
