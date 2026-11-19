import { createSign } from 'node:crypto';

import { GitHubApi } from '@moltnet/docs-impact-review/github-api';

import { required } from './config.js';

/** Renew repository-scoped App tokens without a workflow-stage handoff to CI. */
export function reviewGithubToken(
  repo: string,
  source: NodeJS.ProcessEnv,
): () => Promise<string> {
  const appId = source.ADAPTIVE_GITHUB_APP_ID;
  const privateKey = source.MOLTNET_GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey)
    return () => Promise.resolve(required('GH_TOKEN', source));
  let cached: { token: string; expires_at: string } | undefined;
  let pending: Promise<string> | undefined;
  const mint = async (): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const message = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: appId, iat: now - 60, exp: now + 540 })}`;
    const signature = createSign('RSA-SHA256')
      .update(message)
      .sign(privateKey, 'base64url');
    const api = new GitHubApi({
      token: `${message}.${signature}`,
      apiUrl: source.GITHUB_API_URL,
    });
    const installation = await api.request<{ id: number }>(
      `/repos/${repo}/installation`,
    );
    cached = await api.request<{ token: string; expires_at: string }>(
      `/app/installations/${installation.id}/access_tokens`,
      {
        method: 'POST',
        body: JSON.stringify({
          repositories: [repo.split('/')[1]],
          permissions: { contents: 'read', pull_requests: 'write' },
        }),
      },
    );
    if (!cached.token || !Number.isFinite(Date.parse(cached.expires_at)))
      throw new Error('GitHub returned an invalid reviewer App token');
    return cached.token;
  };
  return async () => {
    if (cached && Date.parse(cached.expires_at) - Date.now() > 5 * 60_000)
      return cached.token;
    pending ??= mint().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
