import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const workflows = fileURLToPath(
  new URL('../../.github/workflows/', import.meta.url),
);

describe('git pathspecs in workflows', () => {
  it('never end a wildcard pathspec with /', () => {
    // `git status -- 'packages/*-action/dist/'` silently matches nothing: a
    // wildcard pathspec is matched against file paths, and none ends in `/`.
    // That hid stale action bundles from CI and the bundle sync. Write
    // ':(glob)packages/*-action/dist/**' instead.
    const offenders = readdirSync(workflows)
      .filter((file) => /\.ya?ml$/.test(file))
      .flatMap((file) =>
        [
          ...readFileSync(join(workflows, file), 'utf8').matchAll(
            /\s--\s[^\n]*?'([^'\n]*[*?[][^'\n]*\/)'/g,
          ),
        ].map((match) => `${file}: ${match[1]}`),
      );

    expect(offenders).toEqual([]);
  });
});
