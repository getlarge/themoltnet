/**
 * The one glob matcher for repository configuration (`docs.exclude`,
 * `docs.agentFacing`, routing `paths`). Semantics follow git pathspecs rather
 * than shell globs, so a pattern means the same thing wherever it is used:
 *
 * - `**` matches any number of path segments, including none;
 * - `*` and `?` match within one segment;
 * - wildcards match names starting with a dot (`**\/CHANGELOG.md` matches
 *   `.github/CHANGELOG.md`);
 * - a pattern without wildcards matches that exact path and everything below
 *   it (`vendor` matches `vendor/a.md`).
 */
const WILDCARD = /[*?]/;

const cache = new Map<string, RegExp>();

function escape(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function compile(glob: string): RegExp {
  const cached = cache.get(glob);
  if (cached) return cached;
  const pattern = glob.replace(/^\/+/, '').replace(/\/+$/, '');
  let source: string;
  if (!WILDCARD.test(pattern)) {
    source = `${escape(pattern)}(?:/.*)?`;
  } else {
    source = '';
    for (let i = 0; i < pattern.length; i += 1) {
      const char = pattern[i];
      if (char === '*' && pattern[i + 1] === '*') {
        const atStart = i === 0 || pattern[i - 1] === '/';
        const next = pattern[i + 2];
        if (atStart && next === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else if (atStart && next === undefined) {
          source += '.*';
          i += 1;
        } else {
          source += '[^/]*';
          i += 1;
        }
      } else if (char === '*') {
        source += '[^/]*';
      } else if (char === '?') {
        source += '[^/]';
      } else {
        source += escape(char);
      }
    }
  }
  const compiled = new RegExp(`^${source}$`);
  cache.set(glob, compiled);
  return compiled;
}

export function matchesGlob(path: string, glob: string): boolean {
  return compile(glob).test(path);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}
