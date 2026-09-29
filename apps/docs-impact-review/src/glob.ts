/**
 * The one glob matcher for repository configuration (`docs.exclude`,
 * `docs.agentFacing`, routing `paths`). Its own small dialect, close to git
 * pathspecs:
 *
 * - `**` as a whole segment matches any number of path segments, including
 *   none;
 * - `*` matches any run of characters within one segment, `?` one character;
 * - wildcards match names starting with a dot (`**\/CHANGELOG.md` matches
 *   `.github/CHANGELOG.md`);
 * - a pattern without wildcards matches that exact path and everything below
 *   it (`vendor` matches `vendor/a.md`);
 * - leading and trailing `/` are ignored; `[` and `]` are not supported
 *   (`validateGlob` rejects them, so they can gain a meaning later).
 *
 * Matching works segment by segment with memoized dynamic programming, never
 * a backtracking regular expression: patterns come from the base branch, but
 * paths come from the pull request, and the cost stays polynomial in both.
 */
const WILDCARD = /[*?]/;

function segments(text: string): string[] {
  return text.split('/').filter((segment) => segment.length > 0);
}

/** Why `glob` is not a usable pattern, or `undefined` when it is. */
export function validateGlob(glob: string): string | undefined {
  if (/[[\]]/.test(glob)) return 'character classes ([ ]) are not supported';
  if (segments(glob).length === 0) return 'the pattern is empty';
  return undefined;
}

/** `*` and `?` within one segment: O(pattern × name). */
function matchSegment(pattern: string, name: string): boolean {
  // previous[j]: pattern[0..i) matches name[0..j).
  let previous = new Array<boolean>(name.length + 1).fill(false);
  previous[0] = true;
  for (let i = 1; i <= pattern.length; i += 1) {
    const char = pattern[i - 1];
    const current = new Array<boolean>(name.length + 1).fill(false);
    // `*` may match the empty string.
    current[0] = char === '*' && previous[0];
    for (let j = 1; j <= name.length; j += 1) {
      if (char === '*') {
        // Either `*` matches nothing more, or it absorbs name[j - 1].
        current[j] = previous[j] || current[j - 1];
      } else {
        current[j] = previous[j - 1] && (char === '?' || char === name[j - 1]);
      }
    }
    previous = current;
  }
  return previous[name.length];
}

/** Segments with `**`: memoized over (pattern index, path index). */
function matchSegments(pattern: string[], path: string[]): boolean {
  const memo = new Map<number, boolean>();
  const width = path.length + 1;
  const visit = (i: number, j: number): boolean => {
    const key = i * width + j;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let result: boolean;
    if (i === pattern.length) {
      result = j === path.length;
    } else if (pattern[i] === '**') {
      // `**` matches no segment, or consumes one and stays in place.
      result = visit(i + 1, j) || (j < path.length && visit(i, j + 1));
    } else {
      result =
        j < path.length &&
        matchSegment(pattern[i], path[j]) &&
        visit(i + 1, j + 1);
    }
    memo.set(key, result);
    return result;
  };
  return visit(0, 0);
}

export function matchesGlob(path: string, glob: string): boolean {
  const pattern = segments(glob);
  if (pattern.length === 0) return false;
  const target = segments(path);
  if (!WILDCARD.test(glob)) {
    // A literal pattern names a path and everything below it.
    return (
      target.length >= pattern.length &&
      pattern.every((segment, index) => segment === target[index])
    );
  }
  return matchSegments(pattern, target);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}
