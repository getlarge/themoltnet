import {
  EXPIRY_BUFFER_MS,
  getRepositoryInstallationToken,
} from '@themoltnet/github-agent';

import { required } from './config.js';

/** One in-memory, single-flight token per repository-scoped review host. */
export function reviewGithubToken(
  repo: string,
  source: NodeJS.ProcessEnv,
  publication: 'report-only' | 'github' = 'github',
): () => Promise<string> {
  const appId = source.ADAPTIVE_GITHUB_APP_ID;
  // Match the escaped-newline environment form accepted by GitHub App auth.
  const privateKeyPem = source.MOLTNET_GITHUB_APP_PRIVATE_KEY?.replace(
    /\\n/g,
    '\n',
  );
  if (!appId || !privateKeyPem)
    return () => Promise.resolve(required('GH_TOKEN', source));
  let cached: { token: string; expiresAt: string } | undefined;
  let pending: Promise<string> | undefined;
  return async () => {
    if (cached && Date.parse(cached.expiresAt) - Date.now() > EXPIRY_BUFFER_MS)
      return cached.token;
    pending ??= getRepositoryInstallationToken({
      appId,
      privateKeyPem,
      repository: repo,
      apiUrl: source.GITHUB_API_URL,
      permissions: {
        contents: 'read',
        pull_requests: publication === 'github' ? 'write' : 'read',
      },
    })
      .then((result) => {
        cached = result;
        return result.token;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
