// lint-staged config (function form).
//
//   - fix:    each staged file's owning Nx project's own `lint` target, run
//             with `--fix` on exactly the staged files of that project. The
//             ESLint command and working directory come from the project
//             graph, so config resolution, overrides and ignores are the ones
//             `nx run <project>:lint` uses. Unfixable violations block the
//             commit. Nothing outside the staged files is modified:
//             `nx affected -t lint --fix` would rewrite every file of every
//             affected project, including dependents with nothing staged.
//   - format: `nx format:write` over exactly the staged files (prettier).
//             TypeScript and JavaScript (including tool .mjs scripts) get both
//             passes.
//
// Dependents and whole-project lint, typecheck and tests are intentionally NOT
// run here; CI covers them.

import { readdirSync } from 'node:fs';
import { relative } from 'node:path';

import { createProjectGraphAsync } from '@nx/devkit';

// lint-staged passes absolute paths, but `nx format:write --files` requires
// repo-relative paths (Nx rejects absolute ones with "path should be a
// path.relative()'d string"). Relativize against the repo root (process.cwd()
// — lint-staged runs from the workspace root).
const toRepoPath = (file) =>
  relative(process.cwd(), file).replaceAll('\\', '/');

const list = (files) => files.map(toRepoPath).join(',');

/**
 * The ESLint invocation of a project's `lint` target, or null when the target
 * is not a single ESLint command. Supports the inferred `eslint .` with a
 * project `cwd` and explicit `eslint [flags] <path>` commands; the trailing
 * lint path is replaced by the staged files.
 */
function eslintInvocation(project) {
  const target = project.data.targets?.lint;
  if (target?.executor !== 'nx:run-commands') return null;
  const options = target.options ?? {};
  const commands = options.command
    ? [options.command]
    : (options.commands ?? []).map((entry) =>
        typeof entry === 'string' ? entry : entry.command,
      );
  const eslint = commands.filter((command) => /^eslint\s/.test(command));
  if (eslint.length !== 1) return null;
  const args = eslint[0].trim().split(/\s+/).slice(1);
  if (args.length === 0 || args.at(-1).startsWith('-')) return null;
  return { cwd: options.cwd ?? '.', flags: args.slice(0, -1) };
}

async function eslintFixCommands(files) {
  const graph = await createProjectGraphAsync({ exitOnError: true });
  const projects = Object.values(graph.nodes)
    .filter((node) => node.data.root && node.data.root !== '.')
    .sort((left, right) => right.data.root.length - left.data.root.length);

  const byProject = new Map();
  for (const file of files.map(toRepoPath)) {
    const owner = projects.find((node) =>
      file.startsWith(`${node.data.root}/`),
    );
    if (!owner) continue;
    byProject.set(owner, [...(byProject.get(owner) ?? []), file]);
  }

  const commands = [];
  for (const [project, projectFiles] of byProject) {
    const invocation = eslintInvocation(project);
    if (!invocation) continue;
    const quoted = projectFiles
      .map((file) => JSON.stringify(relative(invocation.cwd, file)))
      .join(' ');
    commands.push(
      `pnpm --dir ${invocation.cwd} exec eslint ${invocation.flags.join(' ')} --fix --no-warn-ignored ${quoted}`.replace(
        /\s+/g,
        ' ',
      ),
    );
  }
  return commands;
}

const actionlintTargets = (files) =>
  Array.from(
    new Set(
      files.flatMap((file) => {
        const relativeFile = toRepoPath(file);
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
  '*.{ts,tsx,js,jsx,mjs,cjs}': async (files) => [
    ...(await eslintFixCommands(files)),
    `nx format:write --files=${list(files)}`,
  ],
  '*.{json,md,html}': (files) => [`nx format:write --files=${list(files)}`],
  '*.go': ['gofmt -w'],
};
