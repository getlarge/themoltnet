import { describe, expect, it } from 'vitest';

import { resolveGithubAuth } from './config.js';

describe('resolveGithubAuth', () => {
  it('prefers MoltNet GitHub tokens by default even when env tokens exist', () => {
    const provider = () => 'moltnet-token';

    expect(
      resolveGithubAuth({
        envToken: 'stale-env-token',
        tokenProvider: provider,
      }),
    ).toEqual({
      githubAuth: 'moltnet-token',
      githubTokenProvider: provider,
    });
  });

  it('uses env tokens only when requested explicitly', () => {
    expect(
      resolveGithubAuth({
        mode: 'env',
        envToken: 'env-token',
        tokenProvider: () => 'moltnet-token',
      }),
    ).toEqual({ githubAuth: 'env-token', githubToken: 'env-token' });
  });

  it('supports explicit gh-cli auth passthrough', () => {
    expect(
      resolveGithubAuth({
        mode: 'gh-cli',
        envToken: 'env-token',
        tokenProvider: () => 'moltnet-token',
      }),
    ).toEqual({ githubAuth: 'gh-cli' });
  });
});
