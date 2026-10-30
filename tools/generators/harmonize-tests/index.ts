import { posix as path } from 'node:path';

import type { Tree } from '@nx/devkit';
import {
  formatFiles,
  getProjects,
  logger,
  readJson,
  visitNotIgnoredFiles,
  writeJson,
} from '@nx/devkit';
import ts from 'typescript';

import {
  isCodeFile,
  isE2eProject,
  planMoves,
  type ProjectFiles,
  type ProjectInfo,
  referencedFiles,
  rewriteReferences,
  TESTS_DIR,
  transformTestGlob,
} from './plan';
import type { HarmonizeTestsGeneratorSchema } from './schema';

/** Projects whose test layout follows another ecosystem's conventions. */
const SKIPPED_ROOTS = new Set(['libs/cpp-sdk']);
const SCANNED_ROOTS = ['apps', 'libs', 'packages', 'tools'];
const JS_CONFIG_PATTERN =
  /^(?:vite|vitest|playwright|eslint)(?:\.[\w-]+)?\.config\.[cm]?[jt]s$|^wdio\.[\w-]+\.conf\.[cm]?[jt]s$/;
const TEST_FRAMEWORK_IMPORT =
  /from\s+['"](?:vitest|@testing-library\/[^'"]+|@playwright\/test|node:test)['"]/;
const JSON_CONFIG_PATTERN = /^(?:tsconfig(?:\.[\w-]+)?|package|project)\.json$/;

export default async function harmonizeTestsGenerator(
  tree: Tree,
  options: HarmonizeTestsGeneratorSchema,
) {
  if (!options.all && !options.project) {
    throw new Error('Pass --project=<name> or --all.');
  }

  const projects = [...getProjects(tree).entries()]
    .map(([name, config]) => ({ name, root: config.root }))
    .filter((p) => p.root !== '.' && !SKIPPED_ROOTS.has(p.root))
    .sort((a, b) => a.root.localeCompare(b.root));
  const selected = projects.filter(
    (p) => options.all || p.name === options.project,
  );
  if (selected.length === 0) {
    throw new Error(`Project not found: ${options.project}`);
  }

  const projectFiles = selected.map((project) =>
    collectProjectFiles(tree, project, projects),
  );
  const exists = (p: string) => tree.exists(p) && tree.isFile(p);

  const { moves, support } = planMoves({
    projects: projectFiles,
    referencesOf: (project, file) =>
      referencedFiles(
        path.join(project.root, file),
        tree.read(path.join(project.root, file), 'utf-8') ?? '',
        exists,
      )
        .filter((ref) => ref.startsWith(`${project.root}/`))
        .map((ref) => ref.slice(project.root.length + 1)),
    pinnedFiles: (project) =>
      entryPoints(
        tree,
        project,
        projectFiles.find((p) => p.project === project)?.files ?? [],
      ),
    usesTestFramework: (project, file) =>
      TEST_FRAMEWORK_IMPORT.test(
        tree.read(path.join(project.root, file), 'utf-8') ?? '',
      ),
  });

  const unresolved = applyMoves(tree, moves, exists);

  for (const project of selected) {
    updateProjectConfigs(tree, project, moves);
  }

  logger.info(
    `harmonize-tests: ${moves.size} file(s) moved or renamed across ${selected.length} project(s)`,
  );
  if (support.length > 0) {
    logger.info(
      `harmonize-tests: ${support.length} test support file(s) moved under ${TESTS_DIR}/:\n  ${support.join('\n  ')}`,
    );
  }
  if (unresolved.length > 0) {
    logger.warn(
      `harmonize-tests: ${unresolved.length} path expression(s) need a manual check:\n  ${unresolved.join('\n  ')}`,
    );
  }

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

function collectProjectFiles(
  tree: Tree,
  project: ProjectInfo,
  all: ProjectInfo[],
): ProjectFiles {
  const nested = all
    .filter((p) => p.root.startsWith(`${project.root}/`))
    .map((p) => `${p.root}/`);
  const files: string[] = [];
  visitNotIgnoredFiles(tree, project.root, (file) => {
    if (nested.some((root) => file.startsWith(root))) return;
    files.push(file.slice(project.root.length + 1));
  });
  return { project, files };
}

/**
 * Files that are run or loaded by name and must stay in `src/` even when only
 * tests import them: every path a `package.json` string mentions (exports,
 * bins, scripts, Nx target commands) and every script that reads its argv.
 */
function entryPoints(
  tree: Tree,
  project: ProjectInfo,
  files: string[],
): Set<string> {
  const pinned = new Set<string>();
  const packageJsonPath = path.join(project.root, 'package.json');
  if (tree.exists(packageJsonPath)) {
    const collect = (value: unknown) => {
      if (typeof value === 'string') {
        for (const token of value.split(/[\s'"=]+/)) {
          const normalized = path
            .normalize(token)
            .replace(/^\{projectRoot\}\//, '')
            .replace(new RegExp(`^${project.root}/`), '');
          pinned.add(normalized);
        }
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(collect);
      }
    };
    collect(readJson(tree, packageJsonPath));
  }
  for (const file of files) {
    if (!file.startsWith('src/') || !isCodeFile(file)) continue;
    const code = tree.read(path.join(project.root, file), 'utf-8') ?? '';
    if (
      code.startsWith('#!') ||
      /process\.argv|import\.meta\.main/.test(code)
    ) {
      pinned.add(file);
    }
  }
  return pinned;
}

/**
 * Rewrites every scanned code file whose own location or whose references
 * changed, then writes moved files at their new path. Returns the path
 * expressions in moved files that could not be rewritten statically.
 */
function applyMoves(
  tree: Tree,
  moves: Map<string, string>,
  exists: (p: string) => boolean,
): string[] {
  const unresolved: string[] = [];
  const movedNames = [...moves.keys()].map((file) =>
    path.basename(file).replace(/\.[^.]+$/, ''),
  );

  for (const root of SCANNED_ROOTS) {
    if (!tree.exists(root)) continue;
    visitNotIgnoredFiles(tree, root, (file) => {
      if (!isCodeFile(file)) return;
      const target = moves.get(file);
      const code = tree.read(file, 'utf-8') ?? '';
      if (!target && !movedNames.some((name) => code.includes(name))) return;

      const result = rewriteReferences({
        code,
        oldFile: file,
        newFile: target ?? file,
        moves,
        exists,
      });
      for (const entry of result.unresolved) {
        unresolved.push(`${target ?? file}:${entry.line}  ${entry.text}`);
      }
      if (target) {
        tree.write(target, result.code);
        tree.delete(file);
      } else if (result.changed) {
        tree.write(file, result.code);
      }
    });
  }

  for (const [from, to] of moves) {
    if (!isCodeFile(from) && tree.exists(from)) tree.rename(from, to);
  }

  return unresolved;
}

function projectMoves(
  root: string,
  moves: Map<string, string>,
): Map<string, string> {
  const local = new Map<string, string>();
  const prefix = `${root}/`;
  for (const [from, to] of moves) {
    if (from.startsWith(prefix)) {
      local.set(from.slice(prefix.length), to.slice(prefix.length));
    }
  }
  return local;
}

function updateProjectConfigs(
  tree: Tree,
  project: ProjectInfo,
  moves: Map<string, string>,
) {
  const local = projectMoves(project.root, moves);
  const transform = (value: string) =>
    transformConfigString(value, {
      e2e: isE2eProject(project.root),
      moves: local,
    });

  for (const child of tree.children(project.root)) {
    const file = path.join(project.root, child);
    if (!tree.isFile(file)) continue;
    if (JS_CONFIG_PATTERN.test(child)) {
      const code = tree.read(file, 'utf-8') ?? '';
      const next = rewriteStringLiterals(file, code, transform);
      if (next !== code) tree.write(file, next);
    } else if (JSON_CONFIG_PATTERN.test(child)) {
      const json = readJson(tree, file);
      const next = child.startsWith('tsconfig')
        ? transformTsconfig(json, transform)
        : mapStrings(json, transform);
      if (JSON.stringify(next) !== JSON.stringify(json)) {
        writeJson(tree, file, next);
      }
    }
  }

  ensureSpecTsconfigCoversTests(tree, project, local);
}

/**
 * Applies the glob transform to each whitespace-separated token, keeping
 * `!` negations and the `{projectRoot}/` prefix Nx inputs use.
 */
export function transformConfigString(
  value: string,
  options: { e2e: boolean; moves: Map<string, string> },
): string {
  return value.replace(/[^\s'"`]+/g, (token) => {
    const match = /^(!?)(\{projectRoot\}\/)?(.*)$/.exec(token);
    if (!match) return token;
    const [, negation, prefix = '', rest] = match;
    return negation + prefix + transformTestGlob(rest, options);
  });
}

function rewriteStringLiterals(
  file: string,
  code: string,
  transform: (value: string) => string,
): string {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) {
      const next = transform(node.text);
      if (next !== node.text) {
        const quote = node.getText(source)[0];
        edits.push({
          start: node.getStart(source),
          end: node.getEnd(),
          text: `${quote}${next}${quote}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edits
    .sort((a, b) => b.start - a.start)
    .reduce(
      (acc, edit) => acc.slice(0, edit.start) + edit.text + acc.slice(edit.end),
      code,
    );
}

function mapStrings<T>(value: T, transform: (value: string) => string): T {
  if (typeof value === 'string') return transform(value) as T;
  if (Array.isArray(value)) {
    return value.map((item) => mapStrings(item, transform)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        mapStrings(item, transform),
      ]),
    ) as T;
  }
  return value;
}

type TsConfigJson = Record<string, unknown> & {
  exclude?: string[];
  files?: string[];
  include?: string[];
};

function transformTsconfig(
  json: TsConfigJson,
  transform: (value: string) => string,
): TsConfigJson {
  const next = { ...json };
  for (const key of ['include', 'exclude', 'files'] as const) {
    const list = json[key];
    if (!Array.isArray(list)) continue;
    let mapped = [...new Set(list.map(transform))];
    if (key === 'exclude' && mapped.includes(TESTS_DIR)) {
      mapped = mapped.filter((p) => !p.startsWith(`${TESTS_DIR}/`));
    }
    next[key] = mapped;
  }
  return next;
}

function ensureSpecTsconfigCoversTests(
  tree: Tree,
  project: ProjectInfo,
  local: Map<string, string>,
) {
  if (isE2eProject(project.root)) return;
  const specPath = path.join(project.root, 'tsconfig.spec.json');
  const moved = [...local.values()].filter((p) =>
    p.startsWith(`${TESTS_DIR}/`),
  );
  if (!tree.exists(specPath) || moved.length === 0) return;

  const spec = readJson<TsConfigJson>(tree, specPath);
  const include = spec.include ?? [];
  if (include.some((p) => p === TESTS_DIR || p.startsWith(`${TESTS_DIR}/`))) {
    return;
  }
  const extensions = new Set(
    moved
      .filter(isCodeFile)
      .map((p) => path.extname(p))
      .filter((ext) => ['.ts', '.tsx', '.mts'].includes(ext)),
  );
  spec.include = [
    ...include,
    ...[...extensions].sort().map((ext) => `${TESTS_DIR}/**/*${ext}`),
  ];
  writeJson(tree, specPath, spec);
}
