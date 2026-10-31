import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { compareVersions } from './sync-cli-consumer-pins.mjs';

export const pinFiles = [
  '.github/workflows/adaptive-review.yml',
  '.github/workflows/adaptive-review-outcomes.yml',
];
const majorTag = 'adaptive-review-action-v0';
const packageRoot = 'packages/adaptive-review-action';
const apiRoot = 'https://api.github.com/repos/getlarge/themoltnet';
const shaPattern = /^[a-f0-9]{40}$/;

function callerPin(source, file) {
  const workflow = file.replace('.yml', '-reusable.yml');
  const prefix = `uses: getlarge/themoltnet/${workflow}@`;
  const lines = source.split(/\r?\n/).filter((line) => line.includes(prefix));
  const pin = lines[0]?.trim().slice(prefix.length);
  if (
    lines.length !== 1 ||
    !new RegExp(`^[a-f0-9]{40} # ${majorTag}$`).test(pin ?? '')
  ) {
    throw new Error(`Expected one SHA-pinned ${majorTag} caller in ${file}`);
  }
  return { prefix, sha: pin.slice(0, 40) };
}

/** Resolve the built major tag, never the source-only version tag. */
export async function main({
  root = '.',
  get = globalThis.fetch,
  token = process.env.GH_TOKEN,
} = {}) {
  async function api(path) {
    const response = await get(`${apiRoot}/${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(`Cannot read ${path} (${response.status})`);
    }
    return response.json();
  }

  async function versionAt(sha) {
    const file = await api(`contents/${packageRoot}/package.json?ref=${sha}`);
    const metadata = JSON.parse(Buffer.from(file.content, 'base64').toString());
    if (metadata.name !== '@themoltnet/adaptive-review-action') {
      throw new Error(`Unexpected adaptive-review package at ${sha}`);
    }
    compareVersions(metadata.version, '0.0.0');
    return metadata.version;
  }

  // Validate every local caller before changing any file.
  const callers = await Promise.all(
    pinFiles.map(async (file) => {
      const source = await readFile(join(root, file), 'utf8');
      return { file, source, ...callerPin(source, file) };
    }),
  );
  const ref = await api(`git/ref/tags/${majorTag}`);
  const sha = ref.object?.sha;
  if (ref.object?.type !== 'commit' || !shaPattern.test(sha ?? '')) {
    throw new Error(`${majorTag} must point directly to a bundle commit`);
  }
  const version = await versionAt(sha);
  if (!version.startsWith('0.')) {
    throw new Error(
      `${majorTag} points to a different major version: ${version}`,
    );
  }
  const tag = `adaptive-review-action-v${version}`;
  const release = await api(`releases/tags/${tag}`);
  if (release.draft || release.prerelease || release.tag_name !== tag) {
    throw new Error(`${tag} is not a published stable release`);
  }
  const tree = await api(`git/trees/${sha}?recursive=1`);
  const required = [
    ...pinFiles.map((file) => file.replace('.yml', '-reusable.yml')),
    ...['review.js', 'publish.js', 'outcomes.js'].map(
      (entry) => `${packageRoot}/dist/${entry}`,
    ),
  ];
  if (
    tree.truncated ||
    required.some(
      (path) =>
        !tree.tree?.some(
          (entry) =>
            entry.path === path && entry.type === 'blob' && entry.size > 0,
        ),
    )
  ) {
    throw new Error(`${sha} is missing required adaptive-review release files`);
  }
  for (const current of new Set(callers.map((caller) => caller.sha))) {
    if (
      current !== sha &&
      compareVersions(version, await versionAt(current)) < 0
    ) {
      throw new Error(
        `Refusing to downgrade adaptive-review callers to ${version}`,
      );
    }
  }
  for (const { file, source, prefix, sha: current } of callers) {
    if (current === sha) continue;
    await writeFile(
      join(root, file),
      source.replace(`${prefix}${current}`, `${prefix}${sha}`),
    );
    process.stdout.write(`Updated ${file} to ${tag} bundle ${sha}\n`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
