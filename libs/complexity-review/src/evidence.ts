import { createHash } from 'node:crypto';

export type Git = (args: string[]) => string;

export interface ChangedFile {
  path: string;
  patch: string;
  bytes: number;
  /** Generated payloads are summarized explicitly, never presented as full patches. */
  summarized?: boolean;
  /** A source patch may span several packets, with no bytes discarded. */
  segment?: { index: number; total: number };
}

export interface ReviewEvidence {
  manifest: string;
  files: ChangedFile[];
  bytes: number;
  /**
   * Changed files marked `linguist-generated` at the base revision. They stay
   * in the manifest but are not reviewed or mapped.
   */
  generatedPaths: string[];
}

const FULL_OID = /^[0-9a-f]{40}$/;
export const MAX_PATCH_BYTES = 96_000;
const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'go.sum',
]);

/** Paths per `git check-attr` call, far below any argument-length limit. */
const CHECK_ATTR_CHUNK = 500;

/**
 * Changed paths marked `linguist-generated` in the base revision's
 * attributes, never the head's, so a pull request cannot hide its own files
 * from review by editing `.gitattributes`.
 */
function generatedAtBase(
  git: Git,
  base: string,
  paths: readonly string[],
): Set<string> {
  const generated = new Set<string>();
  if (paths.length === 0) return generated;
  // check-attr resolves paths from the working directory and takes no
  // pathspec magic, so root-relative paths are prefixed with the way up.
  const up = git(['rev-parse', '--show-cdup']).trim();
  for (let start = 0; start < paths.length; start += CHECK_ATTR_CHUNK) {
    const chunk = paths.slice(start, start + CHECK_ATTR_CHUNK);
    const fields = git([
      'check-attr',
      '-z',
      `--source=${base}`,
      'linguist-generated',
      '--',
      ...chunk.map((path) => `${up}${path}`),
    ]).split('\0');
    for (let index = 0; index + 2 < fields.length; index += 3) {
      const value = fields[index + 2];
      if (value === 'set' || value === 'true') {
        generated.add(fields[index].slice(up.length));
      }
    }
  }
  return generated;
}

export function buildEvidence(
  git: Git,
  base: string,
  head: string,
): ReviewEvidence {
  if (!FULL_OID.test(base) || !FULL_OID.test(head)) {
    throw new Error('review revisions must be full git OIDs');
  }
  const range = `${base}...${head}`;
  const paths = git(['diff', '--no-ext-diff', '--name-only', '-z', range])
    .split('\0')
    .filter(Boolean);
  const diff = git(['diff', '--no-ext-diff', '--unified=2', range]);
  const patches = diff.split(/(?=^diff --git )/m).filter(Boolean);
  if (patches.length !== paths.length) {
    throw new Error('changed-file manifest does not match diff sections');
  }
  const generated = generatedAtBase(git, base, paths);
  // When nothing else changed, generated files are summarized instead, so
  // the review still has evidence to map.
  const skipGenerated = generated.size > 0 && generated.size < paths.length;
  const files = paths.flatMap((path, index): ChangedFile[] => {
    if (skipGenerated && generated.has(path)) return [];
    const patch = patches[index];
    const bytes = Buffer.byteLength(patch);
    if (bytes === 0) {
      throw new Error(`complexity patch for ${path} is empty`);
    }
    if (
      LOCKFILES.has(path.slice(path.lastIndexOf('/') + 1)) ||
      generated.has(path)
    ) {
      const lines = patch.split('\n');
      const hunkStart = lines.findIndex((line) => line.startsWith('@@'));
      const header = lines
        .slice(0, hunkStart < 0 ? lines.length : hunkStart)
        .join('\n');
      const payload = hunkStart < 0 ? [] : lines.slice(hunkStart);
      const additions = payload.filter((line) => line.startsWith('+')).length;
      const deletions = payload.filter((line) => line.startsWith('-')).length;
      const summary = `${header}\nGenerated lockfile payload summarized: ${bytes} original patch bytes, ${additions} added lines, ${deletions} deleted lines.\nPatch SHA-256: ${createHash('sha256').update(patch).digest('hex')}\nLockfile contents are not reviewed; assess review burden from this metadata and related manifest changes.\n`;
      return [
        {
          path,
          patch: summary,
          bytes: Buffer.byteLength(summary),
          summarized: true,
        },
      ];
    }
    return [{ path, patch, bytes }];
  });
  return {
    manifest: git(['diff', '--no-ext-diff', '--stat', range]),
    files,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    generatedPaths: skipGenerated
      ? paths.filter((path) => generated.has(path))
      : [],
  };
}

export interface ChangeGroup {
  id: string;
  nature: string;
  paths: string[];
}

export interface DomainWork {
  id: string;
  groupId: string;
  nature: string;
  files: ChangedFile[];
}

export function buildDomainWork(
  groups: ChangeGroup[],
  evidence: ReviewEvidence,
): DomainWork[] {
  const byPath = new Map(evidence.files.map((file) => [file.path, file]));
  const work: DomainWork[] = [];
  for (const group of groups) {
    let files: ChangedFile[] = [];
    let bytes = 0;
    let part = 1;
    const flush = () => {
      if (!files.length) return;
      work.push({
        id: `${group.id}-${part++}`,
        groupId: group.id,
        nature: group.nature,
        files,
      });
      files = [];
      bytes = 0;
    };
    for (const path of group.paths) {
      const file = byPath.get(path);
      if (!file) throw new Error(`change map included unknown path ${path}`);
      const chunks = splitPatch(file.patch);
      for (const [index, patch] of chunks.entries()) {
        const chunk =
          chunks.length === 1
            ? file
            : {
                ...file,
                patch,
                bytes: Buffer.byteLength(patch),
                segment: { index: index + 1, total: chunks.length },
              };
        if (
          bytes + chunk.bytes > MAX_PATCH_BYTES ||
          files.some((item) => item.path === chunk.path)
        )
          flush();
        files.push(chunk);
        bytes += chunk.bytes;
      }
    }
    flush();
  }
  return work;
}

/** Lossless UTF-8 packets; prefer line boundaries, including for huge single lines. */
function splitPatch(patch: string): string[] {
  const data = Buffer.from(patch);
  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + MAX_PATCH_BYTES, data.length);
    if (end < data.length) {
      while ((data[end] & 0xc0) === 0x80) end--;
      const newline = data.lastIndexOf(0x0a, end - 1);
      if (newline >= start + MAX_PATCH_BYTES / 2) end = newline + 1;
    }
    chunks.push(data.subarray(start, end).toString('utf8'));
    start = end;
  }
  return chunks;
}
