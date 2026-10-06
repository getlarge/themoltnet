import { matchesAny } from './glob.js';

/** Repository globs that decide which files are documentation. */
export interface DocsGlobs {
  /** Reviewed as documentation besides Markdown. */
  include: readonly string[];
  /** Documentation the repository does not want reviewed. */
  exclude: readonly string[];
}

/** Markdown is always documentation, whatever the case of its extension. */
const MARKDOWN = /\.mdx?$/i;

/**
 * Git pathspecs for the built-in Markdown formats, matching `MARKDOWN`:
 * `top` searches the whole tree whatever the working directory, and `icase`
 * matches `GUIDE.MD` as the regular expression does.
 */
export const MARKDOWN_PATHSPECS: readonly string[] = Object.freeze([
  ':(top,icase)*.md',
  ':(top,icase)*.mdx',
]);

/**
 * A documentation format: Markdown, or a path `include` globs from the
 * repository configuration add (reStructuredText, AsciiDoc, …). Says nothing
 * about exclusion; see `isReviewableDocsPath`.
 */
export function isDocsPath(path: string, include: readonly string[]): boolean {
  return MARKDOWN.test(path) || matchesAny(path, include);
}

/** Documentation the review may read, search, select, or point a finding at. */
export function isReviewableDocsPath(path: string, docs: DocsGlobs): boolean {
  return isDocsPath(path, docs.include) && !matchesAny(path, docs.exclude);
}
