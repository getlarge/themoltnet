import { findInstallationForOwner } from '@themoltnet/github-agent';
import {
  CredentialResolutionError,
  type MoltNetConfig,
  resolveGitHubAppPrivateKey,
  updateGitHubConfig,
} from '@themoltnet/sdk';
import { createNodeSecretProviderRegistry } from '@themoltnet/sdk/node';

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

  if (
    !config.github?.app_id ||
    (!config.github?.private_key_path && !config.github?.private_key_ref)
  ) {
    return {
      status: 'skipped',
      message:
        'github.app_id or private_key_path/private_key_ref missing — cannot resolve',
      installationId: config.github?.installation_id ?? '',
    };
  }

  const targetOwner = currentRepo.split('/')[0];

  // Lazy key source through the shared resolver (both PEM forms). A
  // credential that cannot be resolved is a port failure (rethrown below),
  // not a skipped step — the target must not be left with an unusable
  // identity; only GitHub API failures degrade to `skipped`.
  const github = config.github;
  let result: { installationId: string } | null;
  try {
    result = await findInstallationForOwner({
      appId: github.app_id,
      loadPrivateKeyPem: () =>
        resolveGitHubAppPrivateKey(config, createNodeSecretProviderRegistry()),
      owner: targetOwner,
    });
  } catch (err) {
    if (err instanceof CredentialResolutionError) throw err;
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
  await updateGitHubConfig(
    { ...config.github, installation_id: result.installationId },
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
