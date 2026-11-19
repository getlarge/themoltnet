import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  verifyReviewBundle,
  verifyReviewDependencies,
} from '../../release/adaptive-review-release.mjs';
import { actionEntries } from '../../release/action-release-state.mjs';

const review = {
  name: '@themoltnet/adaptive-review-action',
  devDependencies: { '@themoltnet/agent-daemon-action': 'workspace:*' },
};
const assets = [
  'install.sh',
  'moltnet-agent-linux-x64.tar.gz',
  'moltnet-agent-linux-x64.tar.gz.sha256',
  'moltnet-agent-linux-x64.tar.gz.sha256.sig',
].map((name) => ({ name, size: 42, state: 'uploaded' }));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'review-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path, data) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), JSON.stringify(data));
  };
  await put('packages/adaptive-review-action/package.json', review);
  await put('apps/agent-daemon/package.json', {
    name: '@themoltnet/agent-daemon',
    version: '0.75.0',
  });
  await put('packages/agent-daemon-action/package.json', {
    name: '@themoltnet/agent-daemon-action',
    version: '0.9.0',
  });
  const release = {
    tag_name: 'agent-daemon-v0.75.0',
    draft: false,
    prerelease: false,
    assets,
  };
  const requests = [];
  const api = async (path) => {
    requests.push(path);
    assert.equal(path, 'releases/tags/agent-daemon-v0.75.0');
    return release;
  };
  return { root, put, release, requests, api };
}

test('gates the exact source daemon, independent of newer releases', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await verifyReviewDependencies(f), {
    schemaVersion: 1,
    daemonVersion: '0.75.0',
    workerActionVersion: '0.9.0',
  });
  assert.deepEqual(f.requests, ['releases/tags/agent-daemon-v0.75.0']);
});

for (const [name, change] of [
  [
    'draft',
    (r) => {
      r.draft = true;
    },
  ],
  [
    'prerelease',
    (r) => {
      r.prerelease = true;
    },
  ],
  [
    'wrong version',
    (r) => {
      r.tag_name = 'agent-daemon-v0.76.0';
    },
  ],
  [
    'missing installer',
    (r) => {
      r.assets = assets.filter((a) => a.name !== 'install.sh');
    },
  ],
  [
    'missing signature',
    (r) => {
      r.assets = assets.slice(0, 2);
    },
  ],
  [
    'empty asset',
    (r) => {
      r.assets = assets.map((a) => ({ ...a, size: 0 }));
    },
  ],
  [
    'unfinished upload',
    (r) => {
      r.assets = assets.map((a) => ({ ...a, state: 'open' }));
    },
  ],
]) {
  test(`blocks review publication on ${name}`, async (t) => {
    const f = await fixture(t);
    change(f.release);
    await assert.rejects(
      verifyReviewDependencies(f),
      /awaits published|lacks complete/,
    );
  });
}

test('missing daemon blocks publication; retry after completion uses the same versions', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    verifyReviewDependencies({ ...f, api: async () => undefined }),
    /awaits published/,
  );
  const dependencies = await verifyReviewDependencies(f);
  assert.deepEqual(await verifyReviewDependencies(f), dependencies);
});

test('an API failure cannot be mistaken for an already available dependency', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    verifyReviewDependencies({
      ...f,
      api: async () => {
        throw new Error('403');
      },
    }),
    /403/,
  );
});

test('historical source retries keep their original independent-worker contract', async (t) => {
  const f = await fixture(t);
  await f.put('packages/adaptive-review-action/package.json', {
    name: review.name,
  });
  assert.equal(await verifyReviewDependencies(f), undefined);
  assert.deepEqual(f.requests, []);
  assert.equal(
    actionEntries('adaptive-review-action', {}).includes(
      'worker-action/main.js',
    ),
    false,
  );
  assert.ok(
    actionEntries('adaptive-review-action', review).includes(
      'worker-action/main.js',
    ),
  );
  assert.ok(
    actionEntries('adaptive-review-action', review).includes(
      'release-dependencies.json',
    ),
  );
});

test('invalid source versions are rejected before remote lookup', async (t) => {
  const f = await fixture(t);
  await f.put('apps/agent-daemon/package.json', {
    name: '@themoltnet/agent-daemon',
    version: 'latest',
  });
  await assert.rejects(
    verifyReviewDependencies(f),
    /Invalid review release dependencies/,
  );
  assert.deepEqual(f.requests, []);
});

test('rejects a cached bundle whose daemon or worker differs from its source', async (t) => {
  const f = await fixture(t);
  const path = 'packages/adaptive-review-action/dist/release-dependencies.json';
  const expected = await verifyReviewDependencies(f);
  await f.put(path, expected);
  assert.doesNotThrow(() => verifyReviewBundle(f.root));
  for (const field of ['daemonVersion', 'workerActionVersion']) {
    await f.put(path, { ...expected, [field]: '0.1.0' });
    assert.throws(() => verifyReviewBundle(f.root), /exact source release/);
  }
});
