// lint-staged config (function form) routed through Nx.
//
// lint-staged passes the list of staged files; we feed them to `nx affected`
// so linting and formatting run through the Nx task graph (caching, project
// boundaries) instead of invoking eslint/prettier per file.
//
//   - lint:   `nx affected -t lint --fix` over the projects the staged files
//             belong to. --fix auto-corrects what it can; remaining violations
//             block the commit.
//   - format: `nx format:write` over exactly the staged files (prettier).
//
// Typecheck/test are intentionally NOT run here — `tsc -b` across the affected
// graph is too slow for a commit hook. CI (and pre-push, if added) cover those.
//
// `nx format:write --files` formats the given files directly; the eslint pass
// uses `--files` so Nx scopes `affected` to just the projects those files touch.

import { readdirSync } from 'node:fs';
import { relative } from 'node:path';

// lint-staged passes absolute paths, but `nx affected --files` /
// `nx format:write --files` require repo-relative paths (Nx rejects absolute
// ones with "path should be a path.relative()'d string"). Relativize against
// the repo root (process.cwd() — lint-staged runs from the workspace root).
const list = (files) =>
  files.map((file) => relative(process.cwd(), file)).join(',');

const actionlintTargets = (files) =>
  Array.from(
    new Set(
      files.flatMap((file) => {
        const relativeFile = relative(process.cwd(), file).replaceAll(
          '\\',
          '/',
        );
        if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(relativeFile)) {
          return [relativeFile];
        }
        if (relativeFile === 'packages/agent-daemon-action/action.yml') {
          return readdirSync('.github/workflows')
            .filter((workflow) => /\.ya?ml$/.test(workflow))
            .map((workflow) => `.github/workflows/${workflow}`);
        }
        return [];
      }),
    ),
  );

export default {
  '*.{yaml,yml}': (files) => {
    const targets = actionlintTargets(files);
    return [
      `nx format:write --files=${list(files)}`,
      ...(targets.length > 0
        ? [`github-actionlint -shellcheck= -pyflakes= ${targets.join(' ')}`]
        : []),
    ];
  },
  '*.{ts,tsx}': (files) => [
    `nx affected -t lint --fix --files=${list(files)}`,
    `nx format:write --files=${list(files)}`,
  ],
  '*.{json,md}': (files) => [`nx format:write --files=${list(files)}`],
  '*.go': ['gofmt -w'],
};
