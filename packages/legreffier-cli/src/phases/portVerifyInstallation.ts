import { getInstallationToken } from '@themoltnet/github-agent';
import type { MoltNetConfig } from '@themoltnet/sdk';

export type VerifyInstallationStatus = 'ok' | 'repo-not-in-scope' | 'warning';

export interface PortVerifyInstallationResult {
  status: VerifyInstallationStatus;
  /** Human-readable message for the TUI. */
  message: string;
  /** When status !== 'ok', the repo the port was running against. */
  currentRepo?: string;
  /** When repo-not-in-scope and scope is known, the accessible repo list. */
  accessibleRepos?: string[];
  /** When 'all', the app has access to every repo on the account. */
  repositorySelection?: 'all' | 'selected';
}

interface InstallationReposResponse {
  total_count: number;
  repository_selection: 'all' | 'selected';
  repositories: { full_name: string }[];
}

/**
 * Warning-only check: can the ported GitHub App installation reach the
 * repo the port command is running against?
 *
 * Mints an installation token via github-agent, then calls
 * GET /installation/repositories. Never blocks — returns a warning
 * object the TUI renders. Any failure (bad token, network, missing
 * currentRepo) is downgraded to a warning.
 */
export async function runPortVerifyInstallationPhase(opts: {
  config: MoltNetConfig;
  /** owner/repo of the current target repo. If absent, the phase is skipped. */
  currentRepo?: string;
  apiBaseUrl?: string;
}): Promise<PortVerifyInstallationResult> {
  const { config, currentRepo, apiBaseUrl = 'https://api.github.com' } = opts;

  if (!currentRepo) {
    return {
      status: 'warning',
      message:
        'unable to determine current repo (git remote missing) — skipping installation scope check',
    };
  }
  if (
    !config.github?.app_id ||
    !config.github?.installation_id ||
    !config.github?.private_key_path
  ) {
    return {
      status: 'warning',
      message: 'github.app_id / installation_id / private_key_path missing',
      currentRepo,
    };
  }

  let token: string;
  try {
    const result = await getInstallationToken({
      appId: config.github.app_id,
      privateKeyPath: config.github.private_key_path,
      installationId: config.github.installation_id,
    });
    token = result.token;
  } catch (err) {
    return {
      status: 'warning',
      message: `could not mint installation token: ${(err as Error).message}`,
      currentRepo,
    };
  }

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/installation/repositories?per_page=100`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (err) {
    return {
      status: 'warning',
      message: `installation check network error: ${(err as Error).message}`,
      currentRepo,
    };
  }

  if (!res.ok) {
    return {
      status: 'warning',
      message: `installation check failed (${res.status})`,
      currentRepo,
    };
  }

  const data = (await res.json()) as InstallationReposResponse;
  if (data.repository_selection === 'all') {
    return {
      status: 'ok',
      message: 'installation has access to all repos on the account',
      currentRepo,
      repositorySelection: 'all',
    };
  }

  const accessible = data.repositories.map((r) => r.full_name);
  if (accessible.includes(currentRepo)) {
    return {
      status: 'ok',
      message: `installation has access to ${currentRepo}`,
      currentRepo,
      repositorySelection: 'selected',
      accessibleRepos: accessible,
    };
  }

  return {
    status: 'repo-not-in-scope',
    message:
      `installation is scoped to ${accessible.length} repo(s) but does not include ${currentRepo}. ` +
      `Add the repo at https://github.com/settings/installations/${config.github.installation_id}`,
    currentRepo,
    repositorySelection: 'selected',
    accessibleRepos: accessible,
  };
}
