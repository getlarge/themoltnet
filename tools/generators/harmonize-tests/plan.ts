import { posix as path } from 'node:path';

import ts from 'typescript';

/**
 * Pure planning and rewriting logic for the harmonize-tests generator.
 *
 * Target convention (issue #2880):
 * - one suffix: `*.spec.<ext>`, with `.integration.spec` / `.e2e.spec` kind markers;
 * - one placement: `<projectRoot>/__tests__/`, mirroring the `src/` layout;
 * - `*-e2e` projects contain only tests and keep their layout (suffix only).
 */

export const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const LEGACY_E2E_PATTERN = /\.e2e\.[cm]?[jt]sx?$/;
const CODE_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
const DECLARATION_PATTERN = /\.d\.[cm]?ts$/;

export const TESTS_DIR = '__tests__';

export interface ProjectInfo {
  name: string;
  root: string;
}

export function isTestFile(file: string): boolean {
  if (DECLARATION_PATTERN.test(file)) return false;
  return TEST_FILE_PATTERN.test(file) || LEGACY_E2E_PATTERN.test(file);
}

export function isCodeFile(file: string): boolean {
  return CODE_FILE_PATTERN.test(file) && !DECLARATION_PATTERN.test(file);
}

export function isE2eProject(root: string): boolean {
  return /-e2e$/.test(root);
}

/** `foo.test.ts` → `foo.spec.ts`, `foo.e2e.ts` → `foo.e2e.spec.ts`. */
export function renameTestSuffix(fileName: string): string {
  const test = fileName.replace(/\.test(\.[cm]?[jt]sx?)$/, '.spec$1');
  if (test !== fileName) return test;
  if (/\.spec\.[cm]?[jt]sx?$/.test(fileName)) return fileName;
  return fileName.replace(/\.e2e(\.[cm]?[jt]sx?)$/, '.e2e.spec$1');
}

/**
 * Maps a project-relative path to its `__tests__/` location: a leading
 * `src/`, `tests/` or `__tests__/` segment is dropped, nested `__tests__`
 * segments are flattened, and the result is re-rooted under `__tests__/`.
 */
export function relocateUnderTests(relativePath: string): string {
  const segments = relativePath.split('/');
  if (['src', 'tests', TESTS_DIR].includes(segments[0])) {
    segments.shift();
  }
  return [TESTS_DIR, ...segments.filter((s) => s !== TESTS_DIR)].join('/');
}

/** Files inside a dedicated test folder that is not the canonical one. */
export function isInLegacyTestDir(relativePath: string): boolean {
  const segments = relativePath.split('/');
  if (segments[0] === 'tests') return true;
  return segments.slice(1, -1).includes(TESTS_DIR);
}

export interface ProjectFiles {
  project: ProjectInfo;
  /** Project-relative paths of every tracked file. */
  files: string[];
}

export interface SupportCandidate {
  /** Project-relative path. */
  file: string;
  /** Project-relative paths of the files that reference it. */
  importers: string[];
}

export interface PlanInput {
  projects: ProjectFiles[];
  /** Returns the project-relative paths a file references (code files only). */
  referencesOf: (project: ProjectInfo, file: string) => string[];
  /** Project-relative paths that must never move (package exports, bins). */
  pinnedFiles: (project: ProjectInfo) => Set<string>;
  /** Whether a file imports a test framework (vitest, Testing Library, ...). */
  usesTestFramework: (project: ProjectInfo, file: string) => boolean;
}

export interface MovePlan {
  /** Workspace-relative old path → workspace-relative new path. */
  moves: Map<string, string>;
  /** Workspace-relative paths of non-test files moved as test support. */
  support: string[];
}

/** Base names (without extension) that mark a file as test support. */
const SUPPORT_NAME_PATTERN =
  /(?:^|[-.])test(?:-|$)|test-support|harness$|fixtures?$|fakes?$|^setup-tests$/;

export function isSupportName(file: string): boolean {
  return SUPPORT_NAME_PATTERN.test(
    path.basename(file).replace(/\.[cm]?[jt]sx?$/, ''),
  );
}

export function planMoves(input: PlanInput): MovePlan {
  const moves = new Map<string, string>();
  const support: string[] = [];
  const conflicts: string[] = [];

  for (const { project, files } of input.projects) {
    const e2e = isE2eProject(project.root);
    const local = new Map<string, string>();
    const supportLocal = new Set<string>();

    for (const file of files) {
      if (isTestFile(file)) {
        const dir = path.dirname(file);
        const base = renameTestSuffix(path.basename(file));
        const target = e2e
          ? path.join(dir, base)
          : relocateUnderTests(path.join(dir, base));
        local.set(file, target);
      } else if (!e2e && isInLegacyTestDir(file)) {
        local.set(file, relocateUnderTests(file));
        supportLocal.add(file);
      }
    }

    if (!e2e) {
      for (const file of findSupportFiles(input, project, files, local)) {
        local.set(file, relocateUnderTests(file));
        supportLocal.add(file);
      }
    }

    const targets = new Map<string, string>();
    for (const [from, to] of local) {
      const clash = targets.get(to);
      if (clash !== undefined) {
        conflicts.push(
          `${project.name}: ${from} and ${clash} both map to ${to}`,
        );
      }
      if (to !== from && files.includes(to) && !local.has(to)) {
        conflicts.push(`${project.name}: ${from} would overwrite ${to}`);
      }
      targets.set(to, from);
    }

    for (const [from, to] of local) {
      if (from === to) continue;
      const ws = path.join(project.root, from);
      moves.set(ws, path.join(project.root, to));
      if (supportLocal.has(from)) support.push(ws);
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Resolve these path conflicts first:\n  ${conflicts.join('\n  ')}`,
    );
  }
  return { moves, support: support.sort() };
}

/**
 * Non-test code files under `src/` that only test code references. Being
 * referenced only by tests is not enough: entry points (CLIs, plugin nodes,
 * workers) are often loaded by name rather than imported. A file also needs
 * a test-support name, a test-framework import, or to be reachable only
 * through other support files. Computed as a fixpoint so helpers of helpers
 * follow. Setup files have no importers (configs load them), so a support
 * name alone qualifies those.
 */
function findSupportFiles(
  input: PlanInput,
  project: ProjectInfo,
  files: string[],
  tests: Map<string, string>,
): string[] {
  const pinned = input.pinnedFiles(project);
  const importers = new Map<string, Set<string>>();
  for (const file of files) {
    if (!isCodeFile(file)) continue;
    for (const ref of input.referencesOf(project, file)) {
      if (!importers.has(ref)) importers.set(ref, new Set());
      importers.get(ref)?.add(file);
    }
  }

  const testFiles = new Set(tests.keys());
  const candidates = files.filter(
    (f) =>
      f.startsWith('src/') &&
      isCodeFile(f) &&
      !testFiles.has(f) &&
      !pinned.has(f),
  );

  const found = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const file of candidates) {
      if (found.has(file)) continue;
      const by = [...(importers.get(file) ?? [])];
      const marked =
        isSupportName(file) || input.usesTestFramework(project, file);
      const qualifies =
        by.length === 0
          ? isSupportName(file)
          : by.every((i) => testFiles.has(i) || found.has(i)) &&
            (marked || by.every((i) => found.has(i)));
      if (qualifies) {
        found.add(file);
        changed = true;
      }
    }
  }
  return [...found].sort();
}

// ---------------------------------------------------------------------------
// Reference extraction and rewriting
// ---------------------------------------------------------------------------

export type ReferenceKind = 'module' | 'url' | 'path-call';

export interface Reference {
  kind: ReferenceKind;
  /** Start/end of the replaced text (string literal or argument span). */
  start: number;
  end: number;
  /** Relative specifier or path, as written (path-call: joined literals). */
  value: string;
  quote: string;
}

export interface UnresolvedPath {
  line: number;
  text: string;
}

const MOCK_METHODS = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'importActual',
  'importMock',
]);
const PATH_FUNCTIONS = new Set(['join', 'resolve']);

function isRelative(spec: string): boolean {
  return spec === '.' || spec === '..' || /^\.\.?\//.test(spec);
}

function isDirnameExpression(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return node.text === '__dirname';
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'dirname' &&
    ts.isMetaProperty(node.expression) &&
    node.expression.name.text === 'meta'
  );
}

function isImportMetaUrl(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'url' &&
    ts.isMetaProperty(node.expression) &&
    node.expression.name.text === 'meta'
  );
}

function calleeName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.[cm]?tsx$|\.jsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function extractReferences(
  file: string,
  code: string,
): { references: Reference[]; unresolved: UnresolvedPath[] } {
  const source = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const references: Reference[] = [];
  const unresolved: UnresolvedPath[] = [];
  const handled = new Set<ts.Node>();

  const literal = (node: ts.Node, kind: ReferenceKind) => {
    if (!ts.isStringLiteralLike(node) || !isRelative(node.text)) return;
    references.push({
      kind,
      start: node.getStart(source),
      end: node.getEnd(),
      value: node.text,
      quote: node.getText(source)[0],
    });
  };

  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      literal(node.moduleSpecifier, 'module');
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      literal(node.argument.literal, 'module');
    } else if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const name = calleeName(node.expression);
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        name === 'require'
      ) {
        if (first) literal(first, 'module');
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'vi' &&
        MOCK_METHODS.has(node.expression.name.text)
      ) {
        if (first) literal(first, 'module');
      } else if (
        name &&
        PATH_FUNCTIONS.has(name) &&
        first &&
        isDirnameExpression(first) &&
        node.arguments.length > 1 &&
        node.arguments.slice(1).every(ts.isStringLiteralLike)
      ) {
        const rest = node.arguments.slice(1) as ts.StringLiteralLike[];
        handled.add(first);
        references.push({
          kind: 'path-call',
          start: rest[0].getStart(source),
          end: rest[rest.length - 1].getEnd(),
          value: path.join('.', ...rest.map((a) => a.text)) || '.',
          quote: rest[0].getText(source)[0],
        });
      }
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' &&
      node.arguments?.length === 2 &&
      isImportMetaUrl(node.arguments[1]) &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      handled.add(node.arguments[1]);
      literal(node.arguments[0], 'url');
    } else if (
      (isDirnameExpression(node) || isImportMetaUrl(node)) &&
      !handled.has(node)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      unresolved.push({
        line: line + 1,
        text: code.split('\n')[line].trim(),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return { references, unresolved };
}

const EXTENSION_SWAPS: Array<[RegExp, string[]]> = [
  [/\.js$/, ['.ts', '.tsx']],
  [/\.jsx$/, ['.tsx']],
  [/\.mjs$/, ['.mts']],
  [/\.cjs$/, ['.cts']],
];
const IMPLICIT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs'];

/**
 * Resolves a workspace-relative specifier path to an existing file, and
 * returns how to map that file's new location back to specifier form.
 */
export function resolveTarget(
  specPath: string,
  exists: (p: string) => boolean,
): { file: string; toSpec: (moved: string) => string } | undefined {
  if (exists(specPath)) return { file: specPath, toSpec: (m) => m };
  for (const [pattern, replacements] of EXTENSION_SWAPS) {
    if (!pattern.test(specPath)) continue;
    const ext = specPath.match(pattern)?.[0] ?? '';
    for (const replacement of replacements) {
      const candidate = specPath.replace(pattern, replacement);
      if (exists(candidate)) {
        return {
          file: candidate,
          toSpec: (m) => m.slice(0, -replacement.length) + ext,
        };
      }
    }
  }
  for (const ext of IMPLICIT_EXTENSIONS) {
    if (exists(specPath + ext)) {
      return { file: specPath + ext, toSpec: (m) => m.slice(0, -ext.length) };
    }
  }
  for (const ext of IMPLICIT_EXTENSIONS) {
    const index = path.join(specPath, `index${ext}`);
    if (exists(index)) return { file: index, toSpec: (m) => path.dirname(m) };
  }
  return undefined;
}

function toRelativeSpecifier(
  fromDir: string,
  target: string,
  keepTrailingSlash: boolean,
): string {
  let rel = path.relative(fromDir, target) || '.';
  if (!rel.startsWith('.')) rel = `./${rel}`;
  if (keepTrailingSlash && !rel.endsWith('/')) rel += '/';
  return rel;
}

export interface RewriteResult {
  code: string;
  changed: boolean;
  unresolved: UnresolvedPath[];
}

/**
 * Rewrites the relative references in `code` (originally at `oldFile`, now
 * at `newFile`) so they point at the same targets, following any target that
 * moved according to `moves`. All paths are workspace-relative.
 */
export function rewriteReferences(options: {
  code: string;
  oldFile: string;
  newFile: string;
  moves: Map<string, string>;
  exists: (workspacePath: string) => boolean;
}): RewriteResult {
  const { code, oldFile, newFile, moves, exists } = options;
  const { references, unresolved } = extractReferences(oldFile, code);
  const oldDir = path.dirname(oldFile);
  const newDir = path.dirname(newFile);

  let output = code;
  for (const ref of [...references].sort((a, b) => b.start - a.start)) {
    const keepSlash =
      ref.value.endsWith('/') || ref.value === '.' || ref.value === '..';
    const specPath = path.join(oldDir, ref.value);
    let newSpecPath = specPath;

    if (ref.kind === 'module') {
      const target = resolveTarget(specPath, exists);
      const moved = target && moves.get(target.file);
      if (target && moved) newSpecPath = target.toSpec(moved);
    } else {
      const moved = moves.get(specPath);
      if (moved) newSpecPath = moved;
    }

    if (oldDir === newDir && newSpecPath === specPath) continue;
    const next = toRelativeSpecifier(newDir, newSpecPath, keepSlash);
    if (next === ref.value) continue;

    output =
      output.slice(0, ref.start) +
      `${ref.quote}${next}${ref.quote}` +
      output.slice(ref.end);
  }

  return {
    code: output,
    changed: output !== code,
    unresolved: oldDir === newDir ? [] : unresolved,
  };
}

/** Workspace-relative files referenced by `file` (for the import graph). */
export function referencedFiles(
  file: string,
  code: string,
  exists: (p: string) => boolean,
): string[] {
  const dir = path.dirname(file);
  const result: string[] = [];
  for (const ref of extractReferences(file, code).references) {
    const specPath = path.join(dir, ref.value);
    const target =
      ref.kind === 'module' ? resolveTarget(specPath, exists)?.file : specPath;
    if (target) result.push(target);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Config globs
// ---------------------------------------------------------------------------

/**
 * Maps a test path or glob written relative to the project root onto the
 * target convention. Exact paths follow `moves`; globs get the suffix and
 * placement rules. Returns the input unchanged when it is not test-related.
 */
export function transformTestGlob(
  glob: string,
  options: {
    e2e: boolean;
    /** Project-relative old path → project-relative new path. */
    moves: Map<string, string>;
  },
): string {
  const dotSlash = glob.startsWith('./') ? './' : '';
  let value = dotSlash ? glob.slice(2) : glob;

  const exact = options.moves.get(value);
  if (exact) return dotSlash + exact;

  if (!/test|spec|__tests__|\.e2e\./.test(value)) return glob;

  value = value
    .replace(
      /\{test,spec\}|\{spec,test\}|\(test\|spec\)|\(spec\|test\)/g,
      'spec',
    )
    .replace(/\.test\.(?=[{[(*a-z])/g, '.spec.')
    .replace(/\.e2e\.(?=(?:ts|tsx|js|mjs|\{))/g, '.e2e.spec.');

  if (!options.e2e) {
    if (/^src\/(?:\*\*\/)?__tests__(\/|$)/.test(value)) {
      value = value.replace(/^src\/(?:\*\*\/)?__tests__/, TESTS_DIR);
    } else if (/^tests(\/|$)/.test(value)) {
      value = value.replace(/^tests/, TESTS_DIR);
    } else if (/^src\/.*\.spec\./.test(value)) {
      value = value.replace(/^src\//, `${TESTS_DIR}/`);
    }
  }

  return dotSlash + value;
}
