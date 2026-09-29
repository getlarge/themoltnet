import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The moving major tag for `version`, e.g. `v0` or `docs-impact-review-action-v1`. */
export function stableMajorTagFor(version: string, prefix = 'v'): string {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`GitHub Action package version is not semver: ${version}`);
  }
  return `${prefix}${version.split('.')[0]}`;
}

/**
 * The bundle entries an action runs (`node dist/<entry>`). A `dist/` holding
 * only shared chunks must not pass as a release, so each entry is required.
 */
export function missingBundleEntries(
  bundleDir: string,
  entries: readonly string[],
): string[] {
  if (entries.length === 0) {
    throw new Error('--entries must name at least one bundle entry');
  }
  return entries.filter((entry) => !existsSync(join(bundleDir, entry)));
}

/**
 * `git` arguments that force-push the tag. With a token, it authenticates
 * only this push, so the checkout never persists a write-capable credential.
 */
export function tagPushArgs(tag: string, token?: string): string[] {
  const auth = token
    ? [
        '-c',
        `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
      ]
    : [];
  return [
    ...auth,
    'push',
    'origin',
    `refs/tags/${tag}:refs/tags/${tag}`,
    '--force',
  ];
}
