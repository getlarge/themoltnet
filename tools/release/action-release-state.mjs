import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { compareVersions } from './sync-cli-consumer-pins.mjs';

export const actions = {
  'agent-daemon-action': {
    prefix: 'v',
    entries: ['main.js'],
    workflows: [],
  },
  'adaptive-review-action': {
    prefix: 'adaptive-review-action-v',
    entries: ['review.js', 'publish.js', 'outcomes.js', 'diary-runtime.js'],
    workflows: [
      '.github/workflows/adaptive-review-reusable.yml',
      '.github/workflows/adaptive-review-outcomes-reusable.yml',
    ],
  },
};

export function github(get = globalThis.fetch, token = process.env.GH_TOKEN) {
  return async (path, { optional = false } = {}) => {
    const response = await get(
      `https://api.github.com/repos/getlarge/themoltnet/${path}`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (optional && response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(`Cannot read ${path} (${response.status})`);
    return response.json();
  };
}

export async function listReleases(api) {
  const releases = [];
  for (let page = 1; ; page++) {
    const batch = await api(`releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

export function latest(releases, component) {
  return releases
    .filter(
      (r) =>
        !r.prerelease &&
        new RegExp(`^${component}-v\\d+\\.\\d+\\.\\d+$`).test(r.tag_name),
    )
    .sort((a, b) =>
      compareVersions(
        b.tag_name.slice(component.length + 2),
        a.tag_name.slice(component.length + 2),
      ),
    )[0];
}

async function packageMetadata(api, component, ref) {
  const file = await api(
    `contents/packages/${component}/package.json?ref=${ref}`,
  );
  const metadata = JSON.parse(Buffer.from(file.content, 'base64').toString());
  if (metadata.name !== `@themoltnet/${component}`)
    throw new Error(`Unexpected action package at ${ref}`);
  compareVersions(metadata.version, '0.0.0');
  return metadata;
}

async function packageVersion(api, component, ref) {
  return (await packageMetadata(api, component, ref)).version;
}

// Source manifests opt into co-packaging; old immutable releases retain their
// original entry contract during reconciliation and exact-version retries.
export function actionEntries(component, metadata) {
  const entries = actions[component].entries;
  return component === 'adaptive-review-action' &&
    metadata.devDependencies?.['@themoltnet/agent-daemon-action'] ===
      'workspace:*'
    ? [...entries, 'worker-action/main.js', 'release-dependencies.json']
    : entries;
}

/** Absence is recoverable; a present but inconsistent mapping is an error. */
export async function resolveBundle(
  api,
  component,
  version,
  { published = true, releases } = {},
) {
  if (!actions[component]) throw new Error(`Unknown action ${component}`);
  compareVersions(version, '0.0.0');
  const tag = `${component}-v${version}`;
  // GitHub's tag endpoint excludes drafts. Repair callers reuse the
  // authenticated release listing; consumer pins still require publication.
  const release = published
    ? await api(`releases/tags/${tag}`, { optional: true })
    : (releases ?? (await listReleases(api))).find((r) => r.tag_name === tag);
  if (!release || release.prerelease || (published && release.draft))
    return undefined;
  if (release.tag_name !== tag)
    throw new Error(`Unexpected release for ${tag}`);
  const ref = await api(`git/ref/tags/bundles/${tag}`, { optional: true });
  if (!ref) return undefined;
  const sha = ref.object?.sha;
  if (ref.object?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(sha ?? ''))
    throw new Error(`Invalid bundle ref for ${tag}`);
  const metadata = await packageMetadata(api, component, sha);
  if (metadata.version !== version)
    throw new Error(`Bundle version disagrees with ${tag}`);
  const source = await api(`commits/${tag}`);
  const commit = await api(`git/commits/${sha}`);
  if (commit.parents?.length !== 1 || commit.parents[0].sha !== source.sha)
    throw new Error(`Bundle does not descend directly from ${tag}`);
  const tree = await api(`git/trees/${sha}?recursive=1`);
  const required = [
    'action.yml',
    ...actionEntries(component, metadata).map((p) => `dist/${p}`),
  ]
    .map((p) => `packages/${component}/${p}`)
    .concat(actions[component].workflows);
  if (
    tree.truncated ||
    required.some(
      (path) =>
        !tree.tree?.some(
          (e) => e.path === path && e.type === 'blob' && e.size > 0,
        ),
    )
  ) {
    throw new Error(
      `Bundle ${sha} is missing required ${component} release files`,
    );
  }
  return { sha, release, tag };
}

/** Repair latest component releases and the exact action required by the daemon. */
export async function planRepairs(api, { explicitTag = '', force = [] } = {}) {
  if (
    explicitTag &&
    !/^(agent-daemon-action|adaptive-review-action)-v\d+\.\d+\.\d+$/.test(
      explicitTag,
    )
  )
    throw new Error('Invalid action-tag');
  const releases = await listReleases(api);
  const tags = new Set();
  if (explicitTag) tags.add(explicitTag);
  else {
    for (const component of Object.keys(actions)) {
      const release = latest(releases, component);
      if (release) tags.add(release.tag_name);
    }
    const daemon = latest(
      releases.filter((r) => !r.draft),
      'agent-daemon',
    );
    if (daemon)
      tags.add(
        `agent-daemon-action-v${await packageVersion(api, 'agent-daemon-action', daemon.tag_name)}`,
      );
  }
  const matrix = [];
  for (const tag of tags) {
    const [, component, version] = /^(.*)-v(\d+\.\d+\.\d+)$/.exec(tag);
    const release = releases.find((r) => r.tag_name === tag);
    if (!release) throw new Error(`Cannot find release ${tag} in release list`);
    if (release.prerelease) throw new Error(`Cannot promote prerelease ${tag}`);
    const bundle = await resolveBundle(api, component, version, {
      published: false,
      releases,
    });
    const major = await api(
      `git/ref/tags/${actions[component].prefix}${version.split('.')[0]}`,
      { optional: true },
    );
    const majorVersion = major
      ? await packageVersion(api, component, major.object.sha)
      : '0.0.0';
    const notesComplete =
      bundle &&
      release.body?.includes(`Action bundle commit: \`${bundle.sha}\``);
    if (
      explicitTag ||
      force.includes(component) ||
      release.draft ||
      !bundle ||
      !notesComplete ||
      compareVersions(majorVersion, version) < 0
    ) {
      matrix.push({
        project: `@themoltnet/${component}`,
        component,
        tag,
        entries: actionEntries(
          component,
          component === 'adaptive-review-action'
            ? await packageMetadata(api, component, tag)
            : {},
        ).join(','),
        prefix: actions[component].prefix,
      });
    }
  }
  return matrix;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const matrix = await planRepairs(github(), {
    explicitTag: process.env.ACTION_TAG ?? '',
    force: (process.env.REPUBLISH ?? '').split(',').map((s) => s.trim()),
  });
  console.log(JSON.stringify(matrix));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `actions-matrix=${JSON.stringify(matrix)}\n`,
    );
}
