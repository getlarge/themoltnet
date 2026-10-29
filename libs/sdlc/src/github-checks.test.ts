import { describe, expect, it, vi } from 'vitest';

import { readGithubChecks } from './github-checks.js';
import type { GithubRequest } from './github-coordination.js';

const revision = {
  base: 'base',
  head: 'head',
  policyDigest: 'policy',
  briefDigest: 'brief',
};
function fixture() {
  const binding = {
    revision,
    repository: 'owner/repo',
    suiteId: 3,
    appId: 4,
    checks: { ci: 'CI' },
  };
  const run = {
    id: 1,
    name: 'CI',
    head_sha: 'head',
    app: { id: 4 },
    check_suite: { id: 3 },
    status: 'completed',
    conclusion: 'success',
  };
  const response = { total_count: 1, check_runs: [run] };
  const request = vi
    .fn<GithubRequest>()
    .mockImplementation((path) =>
      Promise.resolve(
        path.includes('/check-runs?')
          ? response
          : { id: 3, head_sha: 'head', app: { id: 4 } },
      ),
    );
  return { binding, run, response, request };
}
describe('bound GitHub check evidence', () => {
  it('accepts success only from the recorded suite, head, and app', async () => {
    const { binding, request } = fixture();
    expect(await readGithubChecks(binding, request)).toEqual({
      ci: { revision, status: 'passed' },
    });
  });
  it.each(['neutral', 'skipped', 'cancelled', 'stale', 'unknown'])(
    'does not accept %s as success',
    async (conclusion) => {
      const { binding, request, run } = fixture();
      run.conclusion = conclusion;
      expect((await readGithubChecks(binding, request)).ci.status).toBe(
        'incomplete',
      );
    },
  );
  it.each([
    ['in_progress', 'pending'],
    ['completed', 'failed'],
  ])(
    'maps %s without treating failure as missing',
    async (status, expected) => {
      const { binding, request, run } = fixture();
      run.status = status;
      run.conclusion = 'failure';
      expect((await readGithubChecks(binding, request)).ci.status).toBe(
        expected,
      );
    },
  );
  it('leaves absent checks missing', async () => {
    const { binding, request, response } = fixture();
    response.total_count = 0;
    response.check_runs = [];
    expect(await readGithubChecks(binding, request)).toEqual({});
  });
  it('rejects spoofed app and head identities', async () => {
    const { binding, request, run } = fixture();
    run.app.id = 999;
    await expect(readGithubChecks(binding, request)).rejects.toThrow(
      'identity',
    );
    run.app.id = 4;
    run.head_sha = 'old';
    await expect(readGithubChecks(binding, request)).rejects.toThrow(
      'identity',
    );
  });
  it('does not choose a green result from duplicate names', async () => {
    const { binding, request, response, run } = fixture();
    response.check_runs.push({ ...run, id: 2, conclusion: 'failure' });
    response.total_count = 2;
    expect((await readGithubChecks(binding, request)).ci.status).toBe(
      'incomplete',
    );
  });
  it('rejects truncated coverage', async () => {
    const { binding, request, response } = fixture();
    response.total_count = 2;
    await expect(readGithubChecks(binding, request)).rejects.toThrow(
      'coverage',
    );
  });
});
