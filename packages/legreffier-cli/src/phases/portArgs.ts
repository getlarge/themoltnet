import { isAbsolute } from 'node:path';

export type PortArgValidation = { ok: true } | { ok: false; error: string };

/**
 * Validate the raw `--from` argument passed to `legreffier port` before
 * any filesystem access.
 *
 * `--from` must be:
 *  - non-empty
 *  - an absolute path (no `~`, no relative paths, no bare repo names)
 *
 * The help text for `port` documents this as a hard requirement because
 * the port pipeline rewrites paths embedded in `moltnet.json` and
 * `gitconfig`, and those rewrites only round-trip correctly when the
 * source is an absolute path. Accepting a relative path here silently
 * produces broken output in git worktrees (different CWD than the main
 * worktree root), so we fail fast instead of letting the port run.
 */
export function validatePortFromArg(fromDir: unknown): PortArgValidation {
  if (typeof fromDir !== 'string' || fromDir.length === 0) {
    return {
      ok: false,
      error: 'legreffier port requires --from <repo-root>/.moltnet/<agent>',
    };
  }

  // `~` is not expanded by the shell inside quoted args and not expanded
  // by Node either; reject it with a hint rather than treating it as a
  // relative path.
  if (fromDir.startsWith('~')) {
    return {
      ok: false,
      error:
        `--from "${fromDir}" uses "~" which is not expanded. ` +
        'Pass an absolute path (e.g. "$HOME/code/other-repo/.moltnet/<agent>").',
    };
  }

  if (!isAbsolute(fromDir)) {
    return {
      ok: false,
      error:
        `--from "${fromDir}" must be an absolute path ` +
        '(e.g. /Users/me/code/other-repo/.moltnet/<agent>). ' +
        'Relative paths break inside git worktrees where the CWD differs ' +
        'from the main worktree root.',
    };
  }

  return { ok: true };
}
