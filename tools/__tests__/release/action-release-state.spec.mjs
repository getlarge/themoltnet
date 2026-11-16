import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  github,
  latest,
  listReleases,
  planRepairs,
  resolveBundle,
} from '../../release/action-release-state.mjs';

const sha = 'b'.repeat(40);
const source = 'a'.repeat(40);
const component = 'agent-daemon-action';
const tag = `${component}-v0.8.0`;
const metadata = (version) => ({
  content: Buffer.from(
    JSON.stringify({ name: `@themoltnet/${component}`, version }),
  ).toString('base64'),
});
function fixture({ complete = false, draft = false } = {}) {
  const release = {
    tag_name: tag,
    draft,
    prerelease: false,
    body: complete ? `Action bundle commit: \`${sha}\`` : '',
  };
  const data = {
    'releases?per_page=100&page=1': [
      release,
      { tag_name: `${component}-v0.6.0`, draft: true },
    ],
    [`releases/tags/${tag}`]: release,
    [`git/ref/tags/bundles/${tag}`]: complete
      ? { object: { type: 'commit', sha } }
      : undefined,
    'git/ref/tags/v0': { object: { type: 'commit', sha } },
    [`contents/packages/${component}/package.json?ref=${sha}`]:
      metadata('0.8.0'),
    [`commits/${tag}`]: { sha: source },
    [`git/commits/${sha}`]: { parents: [{ sha: source }] },
    [`git/trees/${sha}?recursive=1`]: {
      tree: ['action.yml', 'dist/main.js'].map((p) => ({
        path: `packages/${component}/${p}`,
        type: 'blob',
        size: 10,
      })),
    },
  };
  const api = async (path, { optional = false } = {}) => {
    assert.ok(Object.hasOwn(data, path), `Unexpected ${path}`);
    // GitHub's tag endpoint only returns published releases, even with
    // credentials that can see drafts in the release list.
    const value =
      path.startsWith('releases/tags/') && data[path]?.draft
        ? undefined
        : data[path];
    if (value === undefined && !optional) throw new Error(`Missing ${path}`);
    return value;
  };
  return { data, api };
}

test('repairs published-but-unbundled releases, ignoring older abandoned drafts', async () => {
  const { api } = fixture();
  assert.deepEqual(
    (await planRepairs(api)).map((r) => r.tag),
    [tag],
  );
});

test('completion makes reconciliation a no-op; a draft or missing notes still finalizes', async () => {
  const { data, api } = fixture({ complete: true });
  assert.deepEqual(await planRepairs(api), []);
  data[`releases/tags/${tag}`].draft = true;
  assert.equal((await planRepairs(api)).length, 1);
  data[`releases/tags/${tag}`].draft = false;
  data[`releases/tags/${tag}`].body = '';
  assert.equal((await planRepairs(api)).length, 1);
});

for (const complete of [false, true]) {
  for (const explicitTag of ['', tag]) {
    test(`reconciles draft with complete=${complete}, explicit=${!!explicitTag} when tag lookup returns 404`, async () => {
      const { api } = fixture({ complete, draft: true });
      const calls = [];
      const tracked = (...args) => {
        calls.push(args[0]);
        return api(...args);
      };
      assert.deepEqual(
        (await planRepairs(tracked, { explicitTag })).map((r) => r.tag),
        [tag],
      );
      assert.ok(!calls.some((path) => path.startsWith('releases/tags/')));
      assert.equal(
        calls.filter((path) => path.startsWith('releases?')).length,
        1,
      );
    });
  }
}

test('bundle repair can inspect a draft while consumer resolution excludes it', async () => {
  const { api } = fixture({ complete: true, draft: true });
  assert.equal(await resolveBundle(api, component, '0.8.0'), undefined);
  const bundle = await resolveBundle(api, component, '0.8.0', {
    published: false,
  });
  assert.equal(bundle.sha, sha);
  assert.equal(bundle.release.draft, true);
});

test('explicit reconciliation rejects missing releases and prereleases', async () => {
  const { api, data } = fixture();
  await assert.rejects(
    planRepairs(api, { explicitTag: `${component}-v0.9.0` }),
    /Cannot find release/,
  );
  data[`releases/tags/${tag}`].prerelease = true;
  await assert.rejects(
    planRepairs(api, { explicitTag: tag }),
    /Cannot promote prerelease/,
  );
});

test('repairs a lagging major without rolling a newer alias back', async () => {
  const { data, api } = fixture({ complete: true });
  data[`contents/packages/${component}/package.json?ref=${sha}`] =
    metadata('0.8.0');
  const other = 'd'.repeat(40);
  data['git/ref/tags/v0'].object.sha = other;
  data[`contents/packages/${component}/package.json?ref=${other}`] =
    metadata('0.7.1');
  assert.equal((await planRepairs(api)).length, 1);
  data[`contents/packages/${component}/package.json?ref=${other}`] =
    metadata('0.9.0');
  assert.deepEqual(await planRepairs(api), []);
});

test('exact recovery requests are validated and target only the requested version', async () => {
  const { api } = fixture({ complete: true });
  assert.deepEqual(
    (await planRepairs(api, { explicitTag: tag })).map((r) => r.tag),
    [tag],
  );
  await assert.rejects(
    planRepairs(api, { explicitTag: 'main;echo bad' }),
    /Invalid action-tag/,
  );
});

test('republish selects a complete action only when that component is forced', async () => {
  const { api } = fixture({ complete: true });
  assert.deepEqual(await planRepairs(api, { force: [] }), []);
  assert.deepEqual(
    await planRepairs(api, { force: ['adaptive-review-action'] }),
    [],
  );
  assert.deepEqual(
    (await planRepairs(api, { force: [component] })).map((r) => r.tag),
    [tag],
  );
});

test('also repairs the exact action version recorded by the latest published daemon', async () => {
  const { api, data } = fixture({ complete: true });
  data['releases?per_page=100&page=1'].push({
    tag_name: 'agent-daemon-v0.74.3',
  });
  data[`contents/packages/${component}/package.json?ref=agent-daemon-v0.74.3`] =
    metadata('0.7.1');
  const historical = `${component}-v0.7.1`;
  data[`releases/tags/${historical}`] = { tag_name: historical };
  data['releases?per_page=100&page=1'].push(
    data[`releases/tags/${historical}`],
  );
  data[`git/ref/tags/bundles/${historical}`] = undefined;
  assert.deepEqual(
    (await planRepairs(api)).map((r) => r.tag),
    [historical],
  );
});

test('pagination prevents unrelated releases from hiding a component', async () => {
  const filler = Array.from({ length: 100 }, () => ({
    tag_name: 'sdk-v1.0.0',
  }));
  const releases = await listReleases(async (path) =>
    path.endsWith('page=1') ? filler : [{ tag_name: tag }],
  );
  assert.equal(latest(releases, component).tag_name, tag);
});

test('corrupt mappings and API failures fail closed rather than scheduling an overwrite', async () => {
  const { api, data } = fixture({ complete: true });
  data[`git/commits/${sha}`].parents = [{ sha: 'e'.repeat(40) }];
  await assert.rejects(
    resolveBundle(api, component, '0.8.0'),
    /descend directly/,
  );
  const get = github(async () => ({ ok: false, status: 403 }));
  await assert.rejects(get('ref', { optional: true }), /403/);
  assert.equal(
    await github(async () => ({ ok: false, status: 404 }))('ref', {
      optional: true,
    }),
    undefined,
  );
});

for (const bundled of [false, true]) {
  test(`adaptive bundle entry contract follows its source generation: bundled=${bundled}`, async () => {
    const component = 'adaptive-review-action';
    const tag = `${component}-v0.4.1`;
    const pkg = {
      name: `@themoltnet/${component}`,
      version: '0.4.1',
      ...(bundled
        ? {
            devDependencies: {
              '@themoltnet/agent-daemon-action': 'workspace:*',
            },
          }
        : {}),
    };
    const release = { tag_name: tag, draft: true };
    const metadata = {
      content: Buffer.from(JSON.stringify(pkg)).toString('base64'),
    };
    const entries = [
      'review.js',
      'publish.js',
      'outcomes.js',
      'diary-runtime.js',
      ...(bundled
        ? ['worker-action/main.js', 'release-dependencies.json']
        : []),
    ];
    const tree = [
      `packages/${component}/action.yml`,
      ...entries.map((p) => `packages/${component}/dist/${p}`),
      '.github/workflows/adaptive-review-reusable.yml',
      '.github/workflows/adaptive-review-outcomes-reusable.yml',
    ].map((path) => ({ path, type: 'blob', size: 42 }));
    const data = {
      'releases?per_page=100&page=1': [release],
      [`git/ref/tags/bundles/${tag}`]: { object: { type: 'commit', sha } },
      [`contents/packages/${component}/package.json?ref=${sha}`]: metadata,
      [`contents/packages/${component}/package.json?ref=${tag}`]: metadata,
      [`commits/${tag}`]: { sha: source },
      [`git/commits/${sha}`]: { parents: [{ sha: source }] },
      [`git/trees/${sha}?recursive=1`]: { tree },
      'git/ref/tags/adaptive-review-action-v0': undefined,
    };
    const api = async (path) => {
      assert.ok(Object.hasOwn(data, path), path);
      return data[path];
    };
    const plan = await planRepairs(api);
    assert.equal(plan[0].entries, entries.join(','));
    assert.equal(
      (await resolveBundle(api, component, '0.4.1', { published: false })).sha,
      sha,
    );
    if (bundled) {
      for (const file of [
        'worker-action/main.js',
        'release-dependencies.json',
      ]) {
        const entry = tree.find((e) => e.path.endsWith(`dist/${file}`));
        entry.size = 0;
        await assert.rejects(
          resolveBundle(api, component, '0.4.1', { published: false }),
          /missing required/,
        );
        entry.size = 42;
      }
    }
  });
}
