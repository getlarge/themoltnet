import { type DocsGlobs, isDocsPath } from './docs-paths.js';
import { type Git, requireFullOid } from './git.js';
import { matchesAny } from './glob.js';
import { truncateAtLine } from './text.js';
import type {
  BoundedDiff,
  ChangedFile,
  ChangeSet,
  DiffBlock,
  FileCategory,
  FileStatus,
} from './types.js';

/** Machine-produced files that never count as documentation or contract. */
const GENERATED_BASENAMES = new Set([
  'CHANGELOG.md',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'go.sum',
  'Cargo.lock',
  '.release-please-manifest.json',
]);

const TEST_PATTERNS = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /_test\.go$/,
  /(^|\/)(__tests__|__fixtures__|e2e|test|tests|testdata|fixtures)\//,
  /(^|\/)[^/]+-e2e\//,
];

/** Conventional generated-output markers, beyond base `.gitattributes`. */
const GENERATED_PATTERNS = [/(^|\/)generated\//, /\.gen\.[a-z]+$/, /_gen\.go$/];

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function categorize(
  path: string,
  binary: boolean,
  baseGenerated: ReadonlySet<string>,
  docs: DocsGlobs,
): FileCategory {
  if (binary) return 'binary';
  const docsPath = isDocsPath(path, docs.include);
  if (
    baseGenerated.has(path) ||
    (docsPath && matchesAny(path, docs.exclude)) ||
    GENERATED_BASENAMES.has(basename(path)) ||
    GENERATED_PATTERNS.some((pattern) => pattern.test(path))
  ) {
    return 'generated';
  }
  if (TEST_PATTERNS.some((pattern) => pattern.test(path))) return 'test';
  if (docsPath) return 'docs';
  return 'source';
}

function toStatus(code: string): FileStatus {
  switch (code[0]) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    default:
      return 'modified';
  }
}

interface NumstatRecord {
  path: string;
  previousPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

/** Parses `git diff --numstat -z`, where renames carry two NUL paths. */
function parseNumstat(output: string): NumstatRecord[] {
  const fields = output.split('\0');
  const records: NumstatRecord[] = [];
  let index = 0;
  while (index < fields.length) {
    const head = fields[index];
    index += 1;
    if (head === '') continue;
    const [added, deleted, inlinePath] = head.split('\t');
    let path = inlinePath;
    let previousPath: string | undefined;
    if (inlinePath === '') {
      previousPath = fields[index];
      path = fields[index + 1];
      index += 2;
    }
    const binary = added === '-' && deleted === '-';
    records.push({
      path,
      ...(previousPath ? { previousPath } : {}),
      additions: binary ? 0 : Number(added),
      deletions: binary ? 0 : Number(deleted),
      binary,
    });
  }
  return records;
}

/** Parses `git diff --name-status -z` into a path → status map. */
function parseNameStatus(output: string): Map<string, FileStatus> {
  const fields = output.split('\0');
  const statuses = new Map<string, FileStatus>();
  let index = 0;
  while (index < fields.length) {
    const code = fields[index];
    index += 1;
    if (code === '') continue;
    if (code.startsWith('R') || code.startsWith('C')) {
      statuses.set(fields[index + 1], toStatus(code));
      index += 2;
    } else {
      statuses.set(fields[index], toStatus(code));
      index += 1;
    }
  }
  return statuses;
}

/**
 * Resolves `linguist-generated` from the trusted base tree only, so a PR
 * cannot hide its own files from review by editing `.gitattributes`.
 */
function generatedFromBaseAttributes(
  git: Git,
  baseRevision: string,
  paths: string[],
): Set<string> {
  if (paths.length === 0) return new Set();
  // check-attr resolves paths from the working directory and takes no
  // pathspec magic, so root-relative paths are prefixed with the way up.
  const up = git(['rev-parse', '--show-cdup']).trim();
  const output = git(
    [
      'check-attr',
      '-z',
      `--source=${baseRevision}`,
      '--stdin',
      'linguist-generated',
    ],
    `${paths.map((path) => `${up}${path}`).join('\0')}\0`,
  );
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const generated = new Set<string>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const value = fields[index + 2];
    if (value === 'set' || value === 'true') {
      generated.add(fields[index].slice(up.length));
    }
  }
  return generated;
}

/**
 * `docs.exclude` marks documentation the repository does not want reviewed
 * (vendored or generated pages); it is categorized as generated.
 */
export function collectChangeSet(
  git: Git,
  baseRevision: string,
  headRevision: string,
  docs: DocsGlobs,
): ChangeSet {
  requireFullOid(baseRevision, 'base revision');
  requireFullOid(headRevision, 'head revision');
  const range = `${baseRevision}...${headRevision}`;
  const numstat = parseNumstat(
    git(['diff', '--no-color', '--numstat', '-z', '-M', range]),
  );
  const statuses = parseNameStatus(
    git(['diff', '--no-color', '--name-status', '-z', '-M', range]),
  );
  const baseGenerated = generatedFromBaseAttributes(
    git,
    baseRevision,
    numstat.map((record) => record.path),
  );
  const files: ChangedFile[] = numstat.map((record) => ({
    path: record.path,
    ...(record.previousPath ? { previousPath: record.previousPath } : {}),
    status: statuses.get(record.path) ?? 'modified',
    additions: record.additions,
    deletions: record.deletions,
    category: categorize(record.path, record.binary, baseGenerated, docs),
  }));
  return { baseRevision, headRevision, files };
}

export interface DiffBudget {
  totalBytes: number;
  /** One file's block, header included; bounded by `totalBytes`. */
  perFileBytes: number;
  /** Part of `totalBytes` that changed docs fill before source does. */
  docsReserveBytes: number;
  /**
   * Source globs to include before other source when the budget is short,
   * e.g. the paths of the repository's routing rules.
   */
  prioritySources: readonly string[];
}

interface Candidate {
  file: ChangedFile;
  block: string;
  bytes: number;
  truncated: boolean;
}

/**
 * Builds the model-facing diff from source and docs files only. Every file
 * that does not fit is reported, so callers can emit `incomplete` instead of
 * silently reviewing a subset.
 *
 * Packing order, each step skipping what does not fit:
 * 1. changed docs, within `docsReserveBytes`, so a large source change
 *    cannot push the pull request's own docs out;
 * 2. source, `prioritySources` first;
 * 3. the remaining docs, in whatever budget is left.
 *
 * The text lists source before docs, each in packing order.
 */
export function boundDiff(
  git: Git,
  changeSet: ChangeSet,
  budget: DiffBudget,
): BoundedDiff {
  const range = `${changeSet.baseRevision}...${changeSet.headRevision}`;
  const toCandidate = (file: ChangedFile): Candidate => {
    let hunks = '';
    let header: string;
    if (file.status === 'deleted') {
      // The removed body adds little signal; the path already says a
      // contract may be gone, and it would otherwise dominate the budget.
      header = `### ${file.path} (deleted, -${file.deletions} lines)\n`;
    } else {
      const paths = file.previousPath
        ? [file.previousPath, file.path]
        : [file.path];
      // `top`: changed paths are root-relative whatever the working
      // directory; without it a subdirectory run reads empty patches.
      // `literal`: a file name is never a glob.
      const patch = git([
        'diff',
        '--no-color',
        '-M',
        range,
        '--',
        ...paths.map((path) => `:(top,literal)${path}`),
      ]);
      hunks = patch.slice(Math.max(0, patch.indexOf('@@')));
      header = `### ${file.path} (${file.status}${
        file.previousPath ? ` from ${file.previousPath}` : ''
      })\n`;
    }
    // The cap bounds the whole block, header included, so a patch cut to a
    // per-file cap as large as the total still fits instead of being
    // omitted.
    const room = Math.max(
      0,
      Math.min(budget.perFileBytes, budget.totalBytes) -
        Buffer.byteLength(header, 'utf8') -
        1,
    );
    const body = truncateAtLine(hunks, room);
    const block = `${header}${body}\n`;
    return {
      file,
      block,
      bytes: Buffer.byteLength(block, 'utf8'),
      truncated: body !== hunks,
    };
  };
  const byPath = (a: ChangedFile, b: ChangedFile) =>
    a.path.localeCompare(b.path);
  const priority = (file: ChangedFile) =>
    matchesAny(file.path, budget.prioritySources) ? 0 : 1;
  const docs = changeSet.files
    .filter((file) => file.category === 'docs')
    .sort(byPath)
    .map(toCandidate);
  const source = changeSet.files
    .filter((file) => file.category === 'source')
    .sort((a, b) => priority(a) - priority(b) || byPath(a, b))
    .map(toCandidate);

  const taken = new Set<Candidate>();
  let used = 0;
  const pack = (candidates: Candidate[], limit: number) => {
    for (const candidate of candidates) {
      if (taken.has(candidate) || used + candidate.bytes > limit) continue;
      taken.add(candidate);
      used += candidate.bytes;
    }
  };
  pack(docs, budget.docsReserveBytes);
  pack(source, budget.totalBytes);
  pack(docs, budget.totalBytes);

  const blocks: DiffBlock[] = [];
  const result: BoundedDiff = {
    blocks,
    text: '',
    bytes: used,
    includedPaths: [],
    truncatedPaths: [],
    omittedPaths: [],
  };
  for (const candidate of [...source, ...docs]) {
    const { file } = candidate;
    if (!taken.has(candidate)) {
      result.omittedPaths.push(file.path);
      continue;
    }
    blocks.push({
      path: file.path,
      category: file.category,
      text: candidate.block,
    });
    result.includedPaths.push(file.path);
    if (candidate.truncated) result.truncatedPaths.push(file.path);
  }
  result.text = blocks.map((entry) => entry.text).join('');
  return result;
}
