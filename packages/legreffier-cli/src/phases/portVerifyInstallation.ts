import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  getInstallationToken,
  githubAppKeySourceFromConfig,
} from '@themoltnet/github-agent';
import {
  type MoltNetConfig,
  resolveGitHubAppPrivateKey,
} from '@themoltnet/sdk';
import { createNodeSecretProviderRegistry } from '@themoltnet/sdk/node';

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
  /** Token cache location when the PEM is a secret reference. */
  configDir?: string;
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
    (!config.github?.private_key_path && !config.github?.private_key_ref)
  ) {
    return {
      status: 'warning',
      message:
        'github.app_id / installation_id / private_key_path (or private_key_ref) missing',
      currentRepo,
    };
  }

  // One validated key source for both PEM forms: the shared resolver applies
  // provider policy and the RSA check, lazily, on a cache miss only.
  const github = config.github;
  const keySource = githubAppKeySourceFromConfig({
    resolvePem: () =>
      resolveGitHubAppPrivateKey(config, createNodeSecretProviderRegistry()),
    cacheDir:
      opts.configDir ??
      (github.private_key_path
        ? dirname(github.private_key_path)
        : join(tmpdir(), `moltnet-port-verify-${github.app_id}`)),
  });
  let token: string;
  try {
    const result = await getInstallationToken({
      appId: github.app_id,
      installationId: github.installation_id,
      ...keySource,
    });
    token = result.token;
  } catch (err) {
    return {
      status: 'warning',
      message: `could not mint installation token: ${(err as Error).message}`,
      currentRepo,
    };
  }

  // Paginate. GitHub caps per_page at 100; installations with >100 selected
  // repos require following the `Link: rel="next"` header. We short-circuit
  // as soon as `currentRepo` is found to avoid fetching every page for the
  // common case. A safety cap prevents runaway loops.
  const accessible: string[] = [];
  let nextUrl: string | null =
    `${apiBaseUrl}/installation/repositories?per_page=100`;
  let pageCount = 0;
  const MAX_PAGES = 20; // 20 * 100 = 2000 repos — generous upper bound

  while (nextUrl && pageCount < MAX_PAGES) {
    pageCount++;
    let res: Response;
    try {
      res = await fetch(nextUrl, {
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
    for (const r of data.repositories) {
      accessible.push(r.full_name);
    }
    // Short-circuit: if we've seen currentRepo, no need to paginate further.
    if (accessible.includes(currentRepo)) {
      break;
    }
    nextUrl = parseNextLink(res.headers.get('link'));
  }

  if (accessible.includes(currentRepo)) {
    return {
      status: 'ok',
      message: `installation has access to ${currentRepo}`,
      currentRepo,
      repositorySelection: 'selected',
      accessibleRepos: accessible,
    };
  }

  const truncated = pageCount >= MAX_PAGES && nextUrl !== null;
  const truncatedNote = truncated
    ? ' (scan truncated after ' + MAX_PAGES + ' pages — result may be stale)'
    : '';
  return {
    status: 'repo-not-in-scope',
    message:
      `installation is scoped to ${accessible.length}${truncated ? '+' : ''} repo(s) but does not include ${currentRepo}. ` +
      `Add the repo at https://github.com/settings/installations/${config.github.installation_id}` +
      truncatedNote,
    currentRepo,
    repositorySelection: 'selected',
    accessibleRepos: accessible,
  };
}

/**
 * Parse the `Link` header for a `rel="next"` URL. Returns null if absent.
 * GitHub's Link header format:
 *   <https://api.github.com/...?page=2>; rel="next", <...>; rel="last"
 */
function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}
