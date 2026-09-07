import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The documentation links this daemon prints are load-bearing: an operator
 * reaches them when startup has already failed, so a 404 costs them the
 * recovery path.
 *
 * Deliberately offline. Fetching the URL would test the site's availability
 * rather than this repo, and would fail CI whenever docs.themolt.net is down or
 * a developer is on a plane. What actually rots is local — a page renamed, a
 * heading reworded, or a page dropped from the VitePress sidebar and so no
 * longer published — and all three are checkable from the tree.
 *
 * This lives beside the source that prints the links rather than in `tools/`,
 * where the repo's other cross-file contracts sit. CI runs `nx affected`, and
 * editing `agent-context.ts` does not mark `@moltnet/tools` affected, so the
 * guard would not have run on the change that broke it.
 */

const DOCS_ORIGIN = 'https://docs.themolt.net';

/** Sources that print a docs URL to an operator. */
const SOURCES = ['./agent-context.ts', './help.ts'];

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

/** VitePress derives heading anchors the same way GitHub does. */
function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/gu, '-');
}

function headingSlugs(markdown: string): Set<string> {
  return new Set(
    [...markdown.matchAll(/^#{1,6}\s+(.+?)\s*$/gmu)].map((m) => slugify(m[1]!)),
  );
}

const urls = [
  ...new Set(
    SOURCES.flatMap((source) => [
      ...read(source).matchAll(new RegExp(`${DOCS_ORIGIN}[\\w/#-]+`, 'gu')),
    ]).map((match) => match[0]),
  ),
];

describe('documentation links printed at runtime', () => {
  it('finds the links it is meant to guard', () => {
    // Guards the guard: a refactor that stops printing a URL, or renames these
    // sources, would otherwise leave this suite green while checking nothing.
    expect(urls.length).toBeGreaterThan(0);
    expect(urls).toContain(
      `${DOCS_ORIGIN}/operate/agent-keys#run-the-daemon-with-an-agent-key`,
    );
  });

  it.each(urls)('resolves %s to a published page and a real heading', (url) => {
    const { pathname, hash } = new URL(url);

    // The site serves `/operate/agent-keys` from `docs/operate/agent-keys.md`.
    const markdown = read(`../../../../docs${pathname}.md`);

    // A page absent from the sidebar is not published, so the URL would 404
    // even though the file exists.
    expect(read('../../../../docs/.vitepress/config.ts')).toContain(
      `link: '${pathname}'`,
    );

    if (hash) {
      expect(headingSlugs(markdown)).toContain(hash.slice(1));
    }
  });
});
