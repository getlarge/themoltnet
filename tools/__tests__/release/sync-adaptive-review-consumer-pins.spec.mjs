import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  main,
  pinFiles,
} from '../../release/sync-adaptive-review-consumer-pins.mjs';

const oldSha = 'a'.repeat(40);
const bundleSha = 'b'.repeat(40);
const packageRoot = 'packages/adaptive-review-action';
const packageFile = (version) => ({
  content: Buffer.from(
    JSON.stringify({ name: '@themoltnet/adaptive-review-action', version }),
  ).toString('base64'),
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'adaptive-review-pins-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.github/workflows'), { recursive: true });
  const originals = pinFiles.map((file, i) =>
    `jobs:\n  review:\n    uses: getlarge/themoltnet/${file.replace('.yml', '-reusable.yml')}@${oldSha} # adaptive-review-action-v0\n    secrets: inherit\n`.replaceAll(
      '\n',
      i === 0 ? '\n' : '\r\n',
    ),
  );
  for (const [i, file] of pinFiles.entries()) {
    await writeFile(join(root, file), originals[i]);
  }
  const responses = {
    'git/ref/tags/adaptive-review-action-v0': {
      object: { type: 'commit', sha: bundleSha },
    },
    [`contents/${packageRoot}/package.json?ref=${bundleSha}`]:
      packageFile('0.1.2'),
    [`contents/${packageRoot}/package.json?ref=${oldSha}`]:
      packageFile('0.1.0'),
    'releases/tags/adaptive-review-action-v0.1.2': {
      tag_name: 'adaptive-review-action-v0.1.2',
      draft: false,
      prerelease: false,
    },
    [`git/trees/${bundleSha}?recursive=1`]: {
      truncated: false,
      tree: [
        ...pinFiles.map((file) => file.replace('.yml', '-reusable.yml')),
        ...['review.js', 'publish.js', 'outcomes.js'].map(
          (entry) => `${packageRoot}/dist/${entry}`,
        ),
      ].map((path) => ({ path, type: 'blob', size: 100 })),
    },
  };
  const requests = [];
  const get = async (url, init) => {
    requests.push({ url, ...init });
    const path = url.replace(
      'https://api.github.com/repos/getlarge/themoltnet/',
      '',
    );
    assert.ok(Object.hasOwn(responses, path), `Unexpected request: ${path}`);
    return { ok: true, json: async () => responses[path] };
  };
  const contents = () =>
    Promise.all(pinFiles.map((file) => readFile(join(root, file), 'utf8')));
  return { root, originals, responses, requests, get, contents };
}

test('updates both callers to the built SHA, preserves formatting, and is idempotent', async (t) => {
  const f = await fixture(t);
  await main({ ...f, token: 'test-token' });
  const expected = f.originals.map((source) =>
    source.replace(oldSha, bundleSha),
  );
  assert.deepEqual(await f.contents(), expected);
  assert.ok(
    f.requests.every(
      ({ headers }) => headers.authorization === 'Bearer test-token',
    ),
  );
  await main(f);
  assert.deepEqual(await f.contents(), expected);
});

for (const [name, mutate, error] of [
  [
    'draft release',
    (r) => {
      r['releases/tags/adaptive-review-action-v0.1.2'].draft = true;
    },
    /published stable/,
  ],
  [
    'prerelease',
    (r) => {
      r['releases/tags/adaptive-review-action-v0.1.2'].prerelease = true;
    },
    /published stable/,
  ],
  [
    'source-only tag',
    (r) => {
      r[`git/trees/${bundleSha}?recursive=1`].tree = [];
    },
    /missing required/,
  ],
  [
    'missing outcomes bundle',
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
    'downgrade',
    (r) => {
      r[`contents/${packageRoot}/package.json?ref=${oldSha}`] =
        packageFile('0.2.0');
    },
    /downgrade/,
  ],
  [
    'invalid tag target',
    (r) => {
      r['git/ref/tags/adaptive-review-action-v0'].object.sha = 'main';
    },
    /bundle commit/,
  ],
]) {
  test(`leaves both callers unchanged on ${name}`, async (t) => {
    const f = await fixture(t);
    mutate(f.responses);
    await assert.rejects(main(f), error);
    assert.deepEqual(await f.contents(), f.originals);
  });
}

test('validates both callers before any write', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, pinFiles[1]), 'jobs: {}\n');
  await assert.rejects(main(f), /Expected one SHA-pinned/);
  assert.equal((await f.contents())[0], f.originals[0]);
  assert.equal(f.requests.length, 0);
});

test('fails closed on API errors without changing callers', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    main({ ...f, get: async () => ({ ok: false, status: 403 }) }),
    /Cannot read .* \(403\)/,
  );
  assert.deepEqual(await f.contents(), f.originals);
});
