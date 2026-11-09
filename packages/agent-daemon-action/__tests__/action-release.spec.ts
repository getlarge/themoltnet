import { Script } from 'node:vm';

import { getOctokit } from '@actions/github';
import { describe, expect, it, vi } from 'vitest';

import {
  loadAction,
  runStepScript,
  stepById,
  stepWithId,
} from './test-support.js';

const action = loadAction();
const step = stepWithId(action, 'daemon-release');
const validation = stepById(action, 'daemon-version');
const script = step.with?.script;
if (!script) throw new Error('Missing release resolver script');
// github-script executes the input as an async function with github/core arguments.
const resolver = new Script(`(async () => { ${script} })()`);
// secretlint-disable-next-line @secretlint/secretlint-rule-github -- fixture-only token
const token = 'fixture-release-token';

async function run(pages: unknown[], status = 200, networkError = false) {
  let page = 0;
  const outputs: Record<string, string> = {};
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, options) => {
    page++;
    expect(String(url)).toBe(
      `https://api.github.com/repos/getlarge/themoltnet/releases?per_page=100${page > 1 ? `&page=${page}` : ''}`,
    );
    expect(new Headers(options?.headers).get('authorization')).toContain(token);
    expect(options?.redirect).toBe('error');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    if (networkError) throw new Error('fixture network failure');
    return new Response(
      JSON.stringify(
        status === 200 ? pages[page - 1] : { message: 'fixture API failure' },
      ),
      {
        status,
        headers: {
          'content-type': 'application/json',
          ...(page < pages.length
            ? {
                link: `<https://api.github.com/repos/getlarge/themoltnet/releases?per_page=100&page=${page + 1}>; rel="next"`,
              }
            : {}),
        },
      },
    );
  });
  const github = getOctokit(token, {
    baseUrl: step.with?.['base-url'],
    request: { fetch },
  });
  const result = resolver.runInNewContext({
    github,
    core: {
      setOutput: (name: string, value: string) => {
        outputs[name] = value;
      },
    },
    AbortSignal,
  }) as Promise<void>;
  const error: unknown = await result.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  return { error, outputs, fetch };
}

const release = (tag_name: string, overrides = {}) => ({
  tag_name,
  draft: false,
  prerelease: false,
  ...overrides,
});

describe('daemon release lookup', () => {
  it('selects a published stable daemon using the authenticated Octokit client', async () => {
    const result = await run([
      [
        release('agent-daemon-v9.0.0', { draft: true }),
        release('agent-daemon-v8.0.0', { prerelease: true }),
        release('cli-v3.23.0'),
        release('agent-daemon-v7.0.0-rc.1'),
        release('agent-daemon-v6.0.0\ninjected=value'),
        release('agent-daemon-v0.74.3'),
        release('agent-daemon-v0.74.2'),
      ],
    ]);
    expect(result.error).toBeUndefined();
    expect(result.outputs).toEqual({ version: '0.74.3' });
    expect(result.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses GitHub pagination links and stops requesting pages once a daemon is found', async () => {
    const result = await run([
      [release('cli-v3.23.0')],
      [release('agent-daemon-v0.74.3')],
      [release('agent-daemon-v0.74.2')],
    ]);
    expect(result.error).toBeUndefined();
    expect(result.outputs).toEqual({ version: '0.74.3' });
    expect(result.fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['0.74.3', 'latest', 'workspace'])(
    'accepts %s without credentials in validation',
    (version) => {
      const result = runStepScript(validation, { REQUESTED_VERSION: version });
      expect(result.status, result.stderr).toBe(0);
    },
  );

  it.each(['', '^0.74', '0.74.3\ninjected=value'])(
    'rejects invalid version %j before lookup',
    (version) => {
      const result = runStepScript(validation, { REQUESTED_VERSION: version });
      expect(result.status).not.toBe(0);
    },
  );

  it.each([403, 429, 500])(
    'propagates HTTP %s without an anonymous retry',
    async (status) => {
      const result = await run([], status);
      expect(result.error).toMatchObject({ status });
      expect(result.outputs).toEqual({});
      expect(result.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('fails without a version if all releases are drafts or prereleases', async () => {
    const result = await run([
      [
        release('agent-daemon-v9.0.0', { draft: true }),
        release('agent-daemon-v8.0.0', { prerelease: true }),
      ],
    ]);
    expect(String(result.error)).toContain(
      'No published stable agent-daemon release found',
    );
    expect(result.outputs).toEqual({});
  });

  it('propagates network failure without emitting a version', async () => {
    const result = await run([], 200, true);
    expect(String(result.error)).toContain('fixture network failure');
    expect(result.outputs).toEqual({});
    expect(result.fetch).toHaveBeenCalledTimes(1);
  });

  it('scopes the token to github-script and skips it for exact/workspace versions', () => {
    expect(step.uses).toBe(
      'actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd',
    );
    expect(action.inputs['github-release-token'].default).toBe(
      '${{ github.token }}',
    );
    expect(step.with?.['github-token']).toBe(
      '${{ inputs.github-release-token }}',
    );
    expect(step.with?.['base-url']).toBe('https://api.github.com');
    expect(step.with?.retries).toBe('0');
    expect(step.if).toBe("${{ inputs.daemon-version == 'latest' }}");
    const ids = action.runs.steps.map((candidate) => candidate.id);
    expect(ids.indexOf('daemon-version')).toBeLessThan(
      ids.indexOf('daemon-release'),
    );
    for (const id of ['create-task', 'dispatch', 'install-daemon']) {
      expect(ids.indexOf('daemon-release')).toBeLessThan(ids.indexOf(id));
    }
    expect(stepById(action, 'install-daemon').env?.MOLTNET_AGENT_VERSION).toBe(
      '${{ steps.daemon-release.outputs.version || inputs.daemon-version }}',
    );
    // The install step reads the same releases through the API when the
    // public download fails; no other step may see the token.
    expect(stepById(action, 'install-daemon').env?.RELEASE_TOKEN).toBe(
      '${{ inputs.github-release-token }}',
    );
    for (const other of action.runs.steps.filter(
      (candidate) => candidate !== step && candidate.id !== 'install-daemon',
    )) {
      expect(JSON.stringify(other)).not.toContain(
        'inputs.github-release-token',
      );
    }
  });
});
