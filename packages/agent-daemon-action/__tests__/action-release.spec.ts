import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAction, runStepScript, stepById } from './test-support.js';

const action = loadAction();
const step = stepById(action, 'daemon-release');
// secretlint-disable-next-line @secretlint/secretlint-rule-github -- fixture-only token
const token = 'fixture-release-token';
let root: string;
let output: string;
let calls: string;
let preload: string;

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'action-release-'));
  output = resolve(root, 'output');
  calls = resolve(root, 'calls');
  preload = resolve(root, 'fetch.mjs');
  writeFileSync(output, '');
  writeFileSync(calls, '');
  // Execute the real action shell and Node script, replacing only HTTP.
  writeFileSync(
    preload,
    `import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
let page = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.github.com/repos/getlarge/themoltnet/releases?per_page=100&page=' + (++page));
  assert.equal(options.headers.authorization, 'Bearer ' + process.env.RELEASE_TOKEN);
  assert.equal(options.headers.accept, 'application/vnd.github+json');
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  appendFileSync(process.env.CALLS, url + '\\n');
  if (process.env.FETCH_ERROR) throw new Error('fetch failed');
  const status = Number(process.env.HTTP_STATUS);
  return {
    ok: status === 200,
    status,
    json: async () => JSON.parse(process.env.PAGES)[page - 1],
  };
};
`,
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(pages: unknown[], overrides: Record<string, string> = {}) {
  const result = runStepScript(step, {
    REQUESTED_VERSION: 'latest',
    RELEASE_TOKEN: token,
    GITHUB_OUTPUT: output,
    NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
    CALLS: calls,
    PAGES: JSON.stringify(pages),
    HTTP_STATUS: '200',
    ...overrides,
  });
  expect(result.stdout + result.stderr).not.toContain(token);
  return {
    ...result,
    output: readFileSync(output, 'utf8'),
    calls: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean),
  };
}

const release = (tag_name: string, overrides = {}) => ({
  tag_name,
  draft: false,
  prerelease: false,
  ...overrides,
});

describe('daemon release lookup', () => {
  it('resolves a stable daemon tag using authenticated GitHub.com requests', () => {
    const result = run([
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
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toBe('version=0.74.3\n');
    expect(result.calls).toHaveLength(1);
  });

  it('follows pagination when the first page has no daemon release', () => {
    const result = run([
      Array.from({ length: 100 }, () => release('cli-v3.23.0')),
      [release('agent-daemon-v0.74.3')],
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toBe('version=0.74.3\n');
    expect(result.calls).toHaveLength(2);
  });

  it('passes an exact version through without a token or network request', () => {
    const result = run([], { REQUESTED_VERSION: '0.74.3', RELEASE_TOKEN: '' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toBe('version=0.74.3\n');
    expect(result.calls).toHaveLength(0);
  });

  it.each(['', '^0.74', '0.74.3\ninjected=value'])(
    'rejects invalid version %j before HTTP',
    (requested) => {
      const result = run([], { REQUESTED_VERSION: requested });
      expect(result.status).not.toBe(0);
      expect(result.output).toBe('');
      expect(result.calls).toHaveLength(0);
    },
  );

  it('refuses anonymous latest resolution even with ambient GitHub credentials', () => {
    const result = run([], {
      RELEASE_TOKEN: '',
      GH_TOKEN: token,
      GITHUB_TOKEN: token,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('github-release-token is required');
    expect(result.output).toBe('');
    expect(result.calls).toHaveLength(0);
  });

  it.each(['403', '429', '500'])(
    'fails closed on HTTP %s without an anonymous retry',
    (status) => {
      const result = run([], { HTTP_STATUS: status });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`HTTP ${status}`);
      expect(result.output).toBe('');
      expect(result.calls).toHaveLength(1);
    },
  );

  it.each<{ pages: unknown[]; overrides: Record<string, string> }>([
    { pages: [[]], overrides: {} },
    { pages: [{}], overrides: {} },
    { pages: [], overrides: { FETCH_ERROR: '1' } },
  ])(
    'fails closed on empty, invalid or failed responses: %j',
    ({ pages, overrides }) => {
      const result = run(pages, overrides);
      expect(result.status).not.toBe(0);
      expect(result.output).toBe('');
      expect(result.calls).toHaveLength(1);
    },
  );

  it('limits the token to the resolver before task creation and passes only the version to installation', () => {
    expect(action.inputs['github-release-token'].default).toBe(
      '${{ github.token }}',
    );
    expect(step.env?.RELEASE_TOKEN).toBe('${{ inputs.github-release-token }}');
    expect(step.if).toBe("${{ inputs.daemon-version != 'workspace' }}");
    const ids = action.runs.steps.map((candidate) => candidate.id);
    for (const id of ['create-task', 'dispatch', 'install-daemon']) {
      expect(ids.indexOf('daemon-release')).toBeLessThan(ids.indexOf(id));
    }
    const install = stepById(action, 'install-daemon');
    expect(install.env?.MOLTNET_AGENT_VERSION).toBe(
      '${{ steps.daemon-release.outputs.version }}',
    );
    for (const other of action.runs.steps.filter(
      (candidate) => candidate !== step,
    )) {
      expect(JSON.stringify(other)).not.toContain(
        'inputs.github-release-token',
      );
    }
  });
});
