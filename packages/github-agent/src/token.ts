import { createSign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Create a JWT signed with the GitHub App's RSA private key.
 */
function createAppJWT(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iss: appId, iat: now - 60, exp: now + 600 }),
  ).toString('base64url');

  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(privateKeyPem, 'base64url');

  return `${header}.${payload}.${signature}`;
}

interface TokenCache {
  token: string;
  expires_at: string;
  /** Identity the cached token was minted for; records without it are stale. */
  app_id?: string;
  installation_id?: string;
}

/** Minimum remaining validity before we consider a cached token expired. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Read a cached token from disk. Returns null if missing, corrupt, expired,
 * or minted for a different App/installation (legacy records without the
 * identity fields are treated as unmatched and refreshed).
 */
async function readTokenCache(
  cachePath: string,
  appId: string,
  installationId: string,
): Promise<{ token: string; expiresAt: string } | null> {
  try {
    const raw = await readFile(cachePath, 'utf-8');
    const cached: TokenCache = JSON.parse(raw);
    if (!cached.token || !cached.expires_at) return null;
    if (cached.app_id !== appId || cached.installation_id !== installationId) {
      return null;
    }
    const expiresAt = new Date(cached.expires_at).getTime();
    if (Date.now() + EXPIRY_BUFFER_MS >= expiresAt) return null;
    return { token: cached.token, expiresAt: cached.expires_at };
  } catch {
    return null;
  }
}

/**
 * Write a token to the cache file (best-effort), recording which
 * App/installation it belongs to.
 */
async function writeTokenCache(
  cachePath: string,
  record: TokenCache,
): Promise<void> {
  try {
    await writeFile(cachePath, JSON.stringify(record), { mode: 0o600 });
  } catch {
    // best-effort — ignore write failures
  }
}

/**
 * Exchange a GitHub App JWT for an installation access token.
 * Uses a file-based cache (in `cacheDir`, or next to the legacy private key
 * file) to avoid hitting the GitHub API on every call.
 */
interface AppInstallation {
  id: number;
  account: { login: string } | null;
  target_type: string;
}

/**
 * List all installations of this GitHub App and return the one whose
 * `account.login` matches the given owner (case-insensitive).
 *
 * Uses the App JWT (not an installation token), so it works even when
 * `installation_id` is missing or stale.
 */
/**
 * Where the App's RSA private key comes from. Exactly one form:
 * - `privateKeyPem`: resolved PEM text;
 * - `loadPrivateKeyPem`: a lazy loader, invoked only on a cache miss (use this
 *   for secret-provider references so cached lookups never touch the provider);
 * - `privateKeyPath`: the legacy file, cached next to it unless `cacheDir` is
 *   supplied.
 */
export type GitHubAppKeyInput =
  | { privateKeyPem: string; loadPrivateKeyPem?: never; privateKeyPath?: never }
  | {
      loadPrivateKeyPem: () => Promise<string>;
      privateKeyPem?: never;
      privateKeyPath?: never;
    }
  | {
      privateKeyPath: string;
      privateKeyPem?: never;
      loadPrivateKeyPem?: never;
    };

export type GitHubAppKeySource =
  | (Extract<GitHubAppKeyInput, { privateKeyPem: string }> & {
      cacheDir: string;
    })
  | (Extract<
      GitHubAppKeyInput,
      { loadPrivateKeyPem: () => Promise<string> }
    > & {
      cacheDir: string;
    })
  | (Extract<GitHubAppKeyInput, { privateKeyPath: string }> & {
      cacheDir?: string;
    });

async function loadPrivateKeyPem(source: GitHubAppKeyInput): Promise<string> {
  if (source.privateKeyPem !== undefined) return source.privateKeyPem;
  if (source.loadPrivateKeyPem !== undefined) return source.loadPrivateKeyPem();
  return readFile(source.privateKeyPath, 'utf-8');
}

function tokenCachePath(source: GitHubAppKeySource): string {
  const dir =
    source.cacheDir ??
    (source.privateKeyPath !== undefined
      ? dirname(source.privateKeyPath)
      : undefined);
  if (!dir) {
    throw new Error('GitHub App token cache requires a cacheDir');
  }
  return join(dir, 'gh-token-cache.json');
}

/**
 * Build a lazy key source from a `moltnet.json` GitHub section: the PEM is
 * resolved through `resolvePem` (typically the SDK credential resolver over a
 * secret-provider registry) only when a token must actually be minted.
 */
export function githubAppKeySourceFromConfig(opts: {
  resolvePem: () => Promise<string>;
  cacheDir: string;
}): GitHubAppKeySource {
  return { loadPrivateKeyPem: opts.resolvePem, cacheDir: opts.cacheDir };
}

export async function findInstallationForOwner(
  opts: { appId: string; owner: string } & GitHubAppKeyInput,
): Promise<{ installationId: string } | null> {
  const privateKeyPem = await loadPrivateKeyPem(opts);
  const jwt = createAppJWT(opts.appId, privateKeyPem);
  const ownerLower = opts.owner.toLowerCase();

  let nextUrl: string | null =
    'https://api.github.com/app/installations?per_page=100';
  let pageCount = 0;
  // 10 × 100 = 1000 installations — generous for app installations
  // (unlike repo pagination which uses 20 pages for per-installation repos).
  const MAX_PAGES = 10;

  while (nextUrl && pageCount < MAX_PAGES) {
    pageCount++;
    const res: Response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) {
      throw new Error(
        `GitHub API error listing installations (${res.status}): ${await res.text()}`,
      );
    }

    const installations = (await res.json()) as AppInstallation[];
    const match = installations.find(
      (i) => i.account?.login.toLowerCase() === ownerLower,
    );
    if (match) {
      return { installationId: String(match.id) };
    }

    // Follow pagination
    const linkHeader: string | null = res.headers.get('link');
    nextUrl = linkHeader ? parseNextLinkHeader(linkHeader) : null;
  }

  return null;
}

function parseNextLinkHeader(header: string): string | null {
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

export async function getInstallationToken(
  opts: {
    appId: string;
    installationId: string;
    forceRefresh?: boolean;
  } & GitHubAppKeySource,
): Promise<{ token: string; expiresAt: string }> {
  const cachePath = tokenCachePath(opts);

  // Try cache first — only a record minted for this App/installation counts.
  if (!opts.forceRefresh) {
    const cached = await readTokenCache(
      cachePath,
      opts.appId,
      opts.installationId,
    );
    if (cached) return cached;
  }

  // Cache miss — fetch from GitHub API
  const privateKeyPem = await loadPrivateKeyPem(opts);
  const jwt = createAppJWT(opts.appId, privateKeyPem);

  const response = await fetch(
    `https://api.github.com/app/installations/${opts.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    token: string;
    expires_at: string;
  };

  const result = { token: data.token, expiresAt: data.expires_at };

  // Write cache (best-effort)
  await writeTokenCache(cachePath, {
    token: result.token,
    expires_at: result.expiresAt,
    app_id: opts.appId,
    installation_id: opts.installationId,
  });

  return result;
}
