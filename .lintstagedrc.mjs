// lint-staged config (function form) routed through Nx.
//
// lint-staged passes the list of staged files; we feed them to `nx affected`
// so linting and formatting run through the Nx task graph (caching, project
// boundaries) instead of invoking eslint/prettier per file.
//
//   - fix:    `eslint --fix` over exactly the staged files. ESLint resolves
//             each file's nearest eslint.config.mjs (v10 config lookup), so
//             project overrides apply as they do under the project's own lint
//             target. Nx cannot scope a target to individual files, and
//             `nx affected -t lint --fix` would rewrite every file of every
//             affected project, including dependents with nothing staged.
//   - lint:   `nx affected -t lint` (no --fix) over the projects the staged
//             files touch and their dependents. Remaining violations block the
//             commit; nothing outside the staged files is modified.
//   - format: `nx format:write` over exactly the staged files (prettier).
//             TypeScript and JavaScript (including tool .mjs scripts) get both
//             passes.
//
// Typecheck/test are intentionally NOT run here — `tsc -b` across the affected
// graph is too slow for a commit hook. CI (and pre-push, if added) cover those.
//
// `nx format:write --files` formats the given files directly; the Nx lint pass
// uses `--files` so `affected` covers the projects those files touch.

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// lint-staged passes absolute paths, but `nx affected --files` /
// `nx format:write --files` require repo-relative paths (Nx rejects absolute
// ones with "path should be a path.relative()'d string"). Relativize against
// the repo root (process.cwd() — lint-staged runs from the workspace root).
const list = (files) =>
  files.map((file) => relative(process.cwd(), file)).join(',');

const quoted = (files) =>
  files.map((file) => JSON.stringify(relative(process.cwd(), file))).join(' ');

const eslintConfigNames = [
  'eslint.config.mjs',
  'eslint.config.js',
  'eslint.config.cjs',
  'eslint.config.ts',
];

// Only files inside a project with its own ESLint config are linted, matching
// what `nx affected -t lint` covers: repo-root files belong to no lint target.
const inLintedProject = (file) => {
  const root = resolve(process.cwd());
  for (let dir = dirname(resolve(file)); dir !== root; dir = dirname(dir)) {
    if (eslintConfigNames.some((name) => existsSync(join(dir, name)))) {
      return true;
    }
    if (dirname(dir) === dir) return false;
  }
  return false;
};

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
  // JavaScript gets the same treatment as TypeScript: tool scripts such as
  // tools/*.mjs are linted and formatted by CI (nx format:check), so an
  // unformatted .mjs must not get past the commit hook.
  '*.{ts,tsx,js,jsx,mjs,cjs}': (files) => {
    const linted = files.filter(inLintedProject);
    return [
      ...(linted.length > 0
        ? [
            `eslint --flag v10_config_lookup_from_file --fix --no-warn-ignored ${quoted(linted)}`,
          ]
        : []),
      `nx affected -t lint --files=${list(files)}`,
      `nx format:write --files=${list(files)}`,
    ];
  },
  '*.{json,md,html}': (files) => [`nx format:write --files=${list(files)}`],
  '*.go': ['gofmt -w'],
};
