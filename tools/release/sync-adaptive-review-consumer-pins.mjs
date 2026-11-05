import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  github,
  latest,
  listReleases,
  resolveBundle,
} from './action-release-state.mjs';

import { compareVersions } from './sync-cli-consumer-pins.mjs';

export const pinFiles = [
  '.github/workflows/adaptive-review.yml',
  '.github/workflows/adaptive-review-outcomes.yml',
];
const majorTag = 'adaptive-review-action-v0';
const packageRoot = 'packages/adaptive-review-action';

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
  const api = github(get, token);

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
  const release = latest(
    (await listReleases(api)).filter((r) => !r.draft),
    'adaptive-review-action',
  );
  if (!release) throw new Error('No published adaptive-review action');
  const version = release.tag_name.slice('adaptive-review-action-v'.length);
  if (!version.startsWith('0.'))
    throw new Error(`Review the caller major before adopting ${version}`);
  const bundle = await resolveBundle(api, 'adaptive-review-action', version);
  if (!bundle) {
    process.stderr.write(
      `::warning::Adaptive review ${version} awaits its bundle; retaining current callers.\n`,
    );
    return;
  }
  const { sha, tag } = bundle;
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
