import { execSync } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface GitHubAppCredentials {
  appId: string;
  appSlug: string;
  pem: string;
  clientId: string;
  clientSecret: string;
}

export interface BotUser {
  id: number;
  email: string;
}

/** Exchange a GitHub App manifest code for credentials. PEM never leaves the client. */
export async function exchangeManifestCode(
  code: string,
): Promise<GitHubAppCredentials> {
  const res = await fetch(
    `https://api.github.com/app-manifests/${code}/conversions`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub code exchange failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as {
    id: number;
    slug: string;
    pem: string;
    client_id: string;
    client_secret: string;
  };
  return {
    appId: String(data.id),
    appSlug: data.slug,
    pem: data.pem,
    clientId: data.client_id,
    clientSecret: data.client_secret,
  };
}

/** Look up GitHub bot user ID and derive noreply email. */
export async function lookupBotUser(appSlug: string): Promise<BotUser> {
  const res = await fetch(
    `https://api.github.com/users/${encodeURIComponent(appSlug + '[bot]')}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub user lookup failed (${res.status})`);
  }
  const data = (await res.json()) as { id: number; login: string };
  return {
    id: data.id,
    email: `${data.id}+${data.login}@users.noreply.github.com`,
  };
}

/** Write GitHub App PEM to ~/.config/moltnet/<slug>/<appSlug>.pem (mode 0o600). */
export async function writePem(
  pem: string,
  appSlug: string,
  projectSlug: string,
): Promise<string> {
  const dir = join(homedir(), '.config', 'moltnet', projectSlug);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${appSlug}.pem`);
  await writeFile(path, pem, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

export interface GitConfigOptions {
  cwd: string;
  name: string;
  email: string;
}

/** Set git user.name and user.email in the repo at cwd. */
export function writeGitConfig({ cwd, name, email }: GitConfigOptions): void {
  execSync(`git config user.name "${name}"`, { cwd, stdio: 'inherit' });
  execSync(`git config user.email "${email}"`, { cwd, stdio: 'inherit' });
}
