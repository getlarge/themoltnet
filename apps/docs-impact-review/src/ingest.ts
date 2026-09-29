import { type Git, requireFullOid } from './git.js';
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

const DOCS_PATTERN = /\.mdx?$/i;

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function categorize(
  path: string,
  binary: boolean,
  baseGenerated: ReadonlySet<string>,
): FileCategory {
  if (binary) return 'binary';
  if (
    baseGenerated.has(path) ||
    GENERATED_BASENAMES.has(basename(path)) ||
    GENERATED_PATTERNS.some((pattern) => pattern.test(path))
  ) {
    return 'generated';
  }
  if (TEST_PATTERNS.some((pattern) => pattern.test(path))) return 'test';
  if (DOCS_PATTERN.test(path)) return 'docs';
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
  const output = git(
    [
      'check-attr',
      '-z',
      `--source=${baseRevision}`,
      '--stdin',
      'linguist-generated',
    ],
    `${paths.join('\0')}\0`,
  );
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const generated = new Set<string>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const value = fields[index + 2];
    if (value === 'set' || value === 'true') generated.add(fields[index]);
  }
  return generated;
}

export function collectChangeSet(
  git: Git,
  baseRevision: string,
  headRevision: string,
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
    category: categorize(record.path, record.binary, baseGenerated),
  }));
  return { baseRevision, headRevision, files };
}

export interface DiffBudget {
  totalBytes: number;
  perFileBytes: number;
}

/**
 * Builds the model-facing diff from source and docs files only. Every file
 * that does not fit is reported, so callers can emit `incomplete` instead of
 * silently reviewing a subset.
 */
export function boundDiff(
  git: Git,
  changeSet: ChangeSet,
  budget: DiffBudget,
): BoundedDiff {
  const range = `${changeSet.baseRevision}...${changeSet.headRevision}`;
  const eligible = changeSet.files
    .filter((file) => file.category === 'source' || file.category === 'docs')
    .sort(
      (a, b) =>
        Number(a.category === 'docs') - Number(b.category === 'docs') ||
        a.path.localeCompare(b.path),
    );
  const blocks: DiffBlock[] = [];
  const result: BoundedDiff = {
    blocks,
    text: '',
    bytes: 0,
    includedPaths: [],
    truncatedPaths: [],
    omittedPaths: [],
  };
  for (const file of eligible) {
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
      const patch = git(['diff', '--no-color', '-M', range, '--', ...paths]);
      hunks = patch.slice(Math.max(0, patch.indexOf('@@')));
      header = `### ${file.path} (${file.status}${
        file.previousPath ? ` from ${file.previousPath}` : ''
      })\n`;
    }
    const body = truncateAtLine(hunks, budget.perFileBytes);
    const block = `${header}${body}\n`;
    const blockBytes = Buffer.byteLength(block, 'utf8');
    if (result.bytes + blockBytes > budget.totalBytes) {
      result.omittedPaths.push(file.path);
      continue;
    }
    blocks.push({ path: file.path, category: file.category, text: block });
    result.bytes += blockBytes;
    result.includedPaths.push(file.path);
    if (body !== hunks) result.truncatedPaths.push(file.path);
  }
  result.text = blocks.map((entry) => entry.text).join('');
  return result;
}
