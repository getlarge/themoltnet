import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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

/**
 * Exchange a GitHub App JWT for an installation access token.
 */
export async function getInstallationToken(opts: {
  appId: string;
  privateKeyPath: string;
  installationId: string;
}): Promise<{ token: string; expiresAt: string }> {
  const privateKeyPem = await readFile(opts.privateKeyPath, 'utf-8');
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

  return { token: data.token, expiresAt: data.expires_at };
}
