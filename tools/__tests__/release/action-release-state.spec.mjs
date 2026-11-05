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
    if (data[path] === undefined && !optional)
      throw new Error(`Missing ${path}`);
    return data[path];
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
