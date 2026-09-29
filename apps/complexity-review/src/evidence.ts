export type Git = (args: string[]) => string;

export interface ChangedFile {
  path: string;
  patch: string;
  bytes: number;
}

export interface ReviewEvidence {
  manifest: string;
  files: ChangedFile[];
  bytes: number;
}

const FULL_OID = /^[0-9a-f]{40}$/;
export const MAX_PATCH_BYTES = 96_000;
export const MAX_CHANGED_FILES = 120;
export const MAX_REVIEW_TASKS = 8;

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
  if (paths.length > MAX_CHANGED_FILES) {
    throw new Error(
      `complexity review has ${paths.length} changed files, above the ${MAX_CHANGED_FILES}-file limit`,
    );
  }
  const diff = git(['diff', '--no-ext-diff', '--unified=2', range]);
  const patches = diff.split(/(?=^diff --git )/m).filter(Boolean);
  if (patches.length !== paths.length) {
    throw new Error('changed-file manifest does not match diff sections');
  }
  const files = paths.map((path, index) => {
    const patch = patches[index];
    const bytes = Buffer.byteLength(patch);
    if (bytes === 0) {
      throw new Error(`complexity patch for ${path} is empty`);
    }
    if (bytes > MAX_PATCH_BYTES) {
      throw new Error(
        `complexity patch for ${path} is ${bytes} bytes, above the ${MAX_PATCH_BYTES}-byte per-task limit`,
      );
    }
    return { path, patch, bytes };
  });
  return {
    manifest: git(['diff', '--no-ext-diff', '--stat', range]),
    files,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
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
      if (bytes + file.bytes > MAX_PATCH_BYTES) flush();
      files.push(file);
      bytes += file.bytes;
    }
    flush();
  }
  if (work.length > MAX_REVIEW_TASKS) {
    throw new Error(
      `complexity review needs ${work.length} domain tasks, above the ${MAX_REVIEW_TASKS}-task limit`,
    );
  }
  return work;
}
