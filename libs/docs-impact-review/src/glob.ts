import { posix } from 'node:path';

/**
 * Globs in the repository configuration (`docs.exclude`, `docs.agentFacing`,
 * routing `paths`) use Node's `path.matchesGlob` (minimatch syntax), always
 * with POSIX separators. Its pitfalls are documented in the README:
 *
 * - `*` and `**` never match a name that starts with a dot: write the dot
 *   (`**\/.*\/**\/CHANGELOG.md`, `.github/**`);
 * - a pattern matches whole paths: `vendor` is only `vendor`, write
 *   `vendor/**`;
 * - a leading `/` or `./` never matches: paths are relative to the root;
 * - on macOS and Windows, wildcard parts ignore case; CI (Linux) does not.
 */

/**
 * Wildcards allowed in one segment. The matcher backtracks, so a segment
 * like `*a*a*a*a*b` costs exponential time on a long file name; ordinary
 * patterns (`*.md`, `*-guide*.md`) need far fewer.
 */
const MAX_WILDCARDS_PER_SEGMENT = 3;

/** Why `glob` is not a usable pattern, or `undefined` when it is. */
export function validateGlob(glob: string): string | undefined {
  if (!glob.trim()) return 'the pattern is empty';
  if (glob.startsWith('!')) {
    return 'negation (a leading !) is not supported; list what to include';
  }
  if (glob.startsWith('/') || glob.startsWith('./')) {
    return 'paths are relative to the repository root: drop the leading / or ./';
  }
  if (glob.includes('\\')) return 'use / as the separator, not \\';
  const busiest = Math.max(
    ...glob
      .split('/')
      .filter((segment) => segment !== '**')
      .map((segment) => segment.split('*').length - 1),
  );
  if (busiest > MAX_WILDCARDS_PER_SEGMENT) {
    return `at most ${MAX_WILDCARDS_PER_SEGMENT} * per path segment`;
  }
  return undefined;
}

export function matchesGlob(path: string, glob: string): boolean {
  return posix.matchesGlob(path, glob);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}
