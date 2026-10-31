import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  advancePin,
  fetchReleases,
  latestRelease,
  main,
  pinFiles,
} from '../../release/sync-daemon-consumer-pins.mjs';

const workflow = [
  'on:',
  '  workflow_call:',
  '    inputs:',
  '      runtime-ref:',
  '        type: string',
  "        default: ''",
  '      daemon-version:',
  '        type: string',
  "        default: '0.72.2'",
  '',
].join('\n');

const assets = [
  'moltnet-agent-linux-x64.tar.gz',
  'moltnet-agent-linux-x64.tar.gz.sha256',
  'moltnet-agent-linux-x64.tar.gz.sha256.sig',
].map((name) => ({ name }));

function release(tag, overrides = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets,
    ...overrides,
  };
}

for (const [name, newline] of [
  ['LF', '\n'],
  ['CRLF', '\r\n'],
]) {
  test(`advances only the daemon-version default and never rolls back (${name})`, () => {
    const source = workflow.replaceAll('\n', newline);
    const advanced = advancePin(source, '0.73.1');
    assert.equal(advanced, source.replace("'0.72.2'", "'0.73.1'"));
    assert.equal(advancePin(advanced, '0.73.1'), advanced);
    assert.equal(advancePin(advanced, '0.72.2'), advanced);
    assert.throws(
      () =>
        advancePin(
          `      runtime-ref:${newline}        default: ''${newline}`,
          '0.73.1',
        ),
      /daemon pin not found/,
    );
  });
}

test('picks the newest published daemon release by version', () => {
  assert.equal(
    latestRelease([
      release('cli-v3.20.0'),
      release('agent-daemon-v0.9.0'),
      release('agent-daemon-v0.10.0', { draft: true }),
      release('agent-daemon-v0.11.0', { prerelease: true }),
      release('agent-daemon-v0.10.0-rc.1'),
      release('agent-daemon-v0.8.5'),
    ]),
    '0.9.0',
  );
  assert.throws(() => latestRelease([release('cli-v3.20.0')]), /No published/);
});

test('retains the pin while the runner bundle is incomplete', () => {
  assert.equal(
    latestRelease([
      release('agent-daemon-v0.74.0', { assets: assets.slice(0, 2) }),
      release('agent-daemon-v0.73.1'),
    ]),
    undefined,
  );
});

test('authenticates the release listing and fails closed on errors', async () => {
  let headers;
  await fetchReleases(async (_url, init) => {
    headers = init.headers;
    return { ok: true, json: async () => [] };
  }, 'token');
  assert.equal(headers.authorization, 'Bearer token');
  await assert.rejects(
    fetchReleases(async () => ({ ok: false, status: 403 }), undefined),
    /Cannot list GitHub releases \(403\)/,
  );
});

test('every pin file carries a daemon pin', async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  for (const file of pinFiles) {
    const source = await readFile(join(root, file), 'utf8');
    assert.doesNotThrow(() => advancePin(source, '0.0.0'), file);
  }
});

const oldSha = 'a'.repeat(40);
const bundleSha = 'b'.repeat(40);
const actionRoot = 'packages/agent-daemon-action';
const packageFile = (version) => ({
  content: Buffer.from(
    JSON.stringify({
      name: '@themoltnet/agent-daemon-action',
      version,
    }),
  ).toString('base64'),
});

async function fixture(t, newline = '\n') {
  const root = await mkdtemp(join(tmpdir(), 'daemon-action-pins-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.github/workflows'), { recursive: true });
  const source = (
    workflow +
    'jobs:\n' +
    ['classifier', 'worker']
      .map(
        (job) =>
          `  ${job}:\n    steps:\n      - uses: getlarge/themoltnet/${actionRoot}@${oldSha} # v0.7.0\n`,
      )
      .join('')
  ).replaceAll('\n', newline);
  const file = join(root, pinFiles[0]);
  await writeFile(file, source);
  const responses = {
    'releases?per_page=100': [release('agent-daemon-v0.74.1')],
    [`contents/${actionRoot}/package.json?ref=agent-daemon-v0.74.1`]:
      packageFile('0.7.1'),
    'git/ref/tags/v0': { object: { type: 'commit', sha: bundleSha } },
    [`contents/${actionRoot}/package.json?ref=${bundleSha}`]:
      packageFile('0.7.1'),
    [`contents/${actionRoot}/package.json?ref=${oldSha}`]: packageFile('0.7.0'),
    'releases/tags/agent-daemon-action-v0.7.1': release(
      'agent-daemon-action-v0.7.1',
    ),
    [`git/trees/${bundleSha}?recursive=1`]: {
      truncated: false,
      tree: ['action.yml', 'dist/main.js'].map((path) => ({
        path: `${actionRoot}/${path}`,
        type: 'blob',
        size: 100,
      })),
    },
  };
  const get = async (url, init) => {
    assert.equal(init.headers.authorization, 'Bearer test-token');
    const path = url.replace(
      'https://api.github.com/repos/getlarge/themoltnet/',
      '',
    );
    assert.ok(Object.hasOwn(responses, path), `Unexpected request: ${path}`);
    return { ok: true, json: async () => responses[path] };
  };
  return { root, source, file, responses, get, token: 'test-token' };
}

for (const newline of ['\n', '\r\n']) {
  test(`updates the compatible pair together, preserving ${JSON.stringify(newline)}, idempotently`, async (t) => {
    const f = await fixture(t, newline);
    await main(f);
    const expected = f.source
      .replace("'0.72.2'", "'0.74.1'")
      .replaceAll(oldSha, bundleSha)
      .replaceAll('# v0.7.0', '# v0.7.1');
    assert.equal(await readFile(f.file, 'utf8'), expected);
    await main(f);
    assert.equal(await readFile(f.file, 'utf8'), expected);
  });
}

for (const [name, mutate, error] of [
  [
    'draft action',
    (r) => {
      r['releases/tags/agent-daemon-action-v0.7.1'].draft = true;
    },
    /published stable/,
  ],
  [
    'prerelease action',
    (r) => {
      r['releases/tags/agent-daemon-action-v0.7.1'].prerelease = true;
    },
    /published stable/,
  ],
  [
    'incompatible action',
    (r) => {
      r[`contents/${actionRoot}/package.json?ref=${bundleSha}`] =
        packageFile('0.8.0');
    },
    /different version/,
  ],
  [
    'source-only tag',
    (r) => {
      r[`git/trees/${bundleSha}?recursive=1`].tree.pop();
    },
    /missing required/,
  ],
  [
    'truncated tree',
    (r) => {
      r[`git/trees/${bundleSha}?recursive=1`].truncated = true;
    },
    /missing required/,
  ],
  [
    'invalid tag',
    (r) => {
      r['git/ref/tags/v0'].object.sha = 'main';
    },
    /bundle commit/,
  ],
  [
    'incorrect comment',
    (r) => {
      r[`contents/${actionRoot}/package.json?ref=${oldSha}`] =
        packageFile('0.6.0');
    },
    /comment disagrees/,
  ],
]) {
  test(`leaves all pins unchanged on ${name}`, async (t) => {
    const f = await fixture(t);
    mutate(f.responses);
    await assert.rejects(main(f), error);
    assert.equal(await readFile(f.file, 'utf8'), f.source);
  });
}

test('leaves the pair unchanged while the daemon bundle is incomplete', async (t) => {
  const f = await fixture(t);
  f.responses['releases?per_page=100'][0].assets = [];
  await main(f);
  assert.equal(await readFile(f.file, 'utf8'), f.source);
});

for (const kind of ['daemon', 'action']) {
  test(`refuses a ${kind} downgrade without updating either side`, async (t) => {
    const f = await fixture(t);
    const source =
      kind === 'daemon'
        ? f.source.replace('0.72.2', '0.75.0')
        : f.source.replaceAll('# v0.7.0', '# v0.8.0');
    if (kind === 'action')
      f.responses[`contents/${actionRoot}/package.json?ref=${oldSha}`] =
        packageFile('0.8.0');
    await writeFile(f.file, source);
    await assert.rejects(main(f), /downgrade/);
    assert.equal(await readFile(f.file, 'utf8'), source);
  });
}

test('rejects malformed consumers and API failures before any write', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    main({ ...f, get: async () => ({ ok: false, status: 403 }) }),
    /403/,
  );
  assert.equal(await readFile(f.file, 'utf8'), f.source);
  const source = f.source.replace(' # v0.7.0', '');
  await writeFile(f.file, source);
  await assert.rejects(
    main({ ...f, get: () => assert.fail('unexpected request') }),
    /Expected one daemon/,
  );
  assert.equal(await readFile(f.file, 'utf8'), source);
});
