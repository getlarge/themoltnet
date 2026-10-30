import type { GithubRequest } from './github-coordination.js';

/** Validate a delivered draft using provider data, including both sides of renames. */
export function verifyGithubDraft(
  input: Omit<Parameters<typeof verifyGithubChange>[0], 'draft'>,
) {
  return verifyGithubChange({ ...input, draft: true });
}

/** Verify either phase of an open change; callers decide whether draft status is required. */
export async function verifyGithubChange(input: {
  draft?: boolean;
  request: GithubRequest;
  repository: string;
  pr: number;
  expectedHead: string;
  expectedBranch: string;
  baseBranch: string;
  /** Repository-relative files or directory prefixes ending in '/'. No glob interpretation. */
  allowedPaths: readonly string[];
  protectedPaths: readonly string[];
}): Promise<{ base: string; head: string } | undefined> {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(input.repository) ||
    !Number.isSafeInteger(input.pr) ||
    input.pr <= 0 ||
    !input.expectedHead ||
    !input.expectedBranch ||
    !input.baseBranch ||
    !input.allowedPaths.length ||
    [...input.allowedPaths, ...input.protectedPaths].some(
      (path) => !validPath(path),
    )
  )
    throw new Error('Invalid draft verification policy');
  const path = `/repos/${input.repository}/pulls/${input.pr}`;
  const before = snapshot(await input.request(path, 'GET'));
  if (!eligible(before, input)) return undefined;
  const files = new Set<string>();
  for (let page = 1; ; page += 1) {
    if (page > 30) return undefined; // GitHub's files endpoint exposes at most 3,000 files.
    const result = await input.request(
      `${path}/files?per_page=100&page=${page}`,
      'GET',
    );
    if (!Array.isArray(result) || result.length > 100)
      throw new Error('Invalid PR file page');
    for (const raw of result) {
      const file = record(raw);
      if (
        typeof file.filename !== 'string' ||
        !validPath(file.filename) ||
        files.has(file.filename)
      )
        return undefined;
      const paths = [file.filename];
      if (file.status === 'renamed') {
        if (
          typeof file.previous_filename !== 'string' ||
          !validPath(file.previous_filename)
        )
          return undefined;
        paths.push(file.previous_filename);
      }
      if (
        paths.some(
          (name) =>
            input.protectedPaths.some((pattern) => matches(name, pattern)) ||
            !input.allowedPaths.some((pattern) => matches(name, pattern)),
        )
      )
        return undefined;
      files.add(file.filename);
    }
    if (result.length < 100) break;
  }
  if (!files.size || files.size !== before.changedFiles) return undefined;
  const after = snapshot(await input.request(path, 'GET'));
  if (
    !eligible(after, input) ||
    after.head !== before.head ||
    after.base !== before.base ||
    after.changedFiles !== files.size
  )
    return undefined;
  return { base: after.base, head: after.head };
}

function matches(path: string, pattern: string): boolean {
  return pattern.endsWith('/') ? path.startsWith(pattern) : path === pattern;
}
function validPath(path: string): boolean {
  return (
    Boolean(path) &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').some((part) => part === '.' || part === '..') &&
    !path.includes('\0')
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid GitHub change response');
  return value as Record<string, unknown>;
}
function snapshot(value: unknown) {
  const pr = record(value);
  const head = record(pr.head);
  const base = record(pr.base);
  const headRepo = record(head.repo);
  const baseRepo = record(base.repo);
  if (
    typeof head.sha !== 'string' ||
    typeof base.sha !== 'string' ||
    typeof head.ref !== 'string' ||
    typeof base.ref !== 'string' ||
    typeof headRepo.full_name !== 'string' ||
    typeof baseRepo.full_name !== 'string' ||
    typeof pr.changed_files !== 'number' ||
    !Number.isSafeInteger(pr.changed_files)
  )
    throw new Error('Invalid GitHub change identity');
  return {
    head: head.sha,
    base: base.sha,
    branch: head.ref,
    baseBranch: base.ref,
    headRepo: headRepo.full_name,
    baseRepo: baseRepo.full_name,
    draft: pr.draft === true,
    open: pr.state === 'open',
    merged: pr.merged !== false,
    changedFiles: pr.changed_files,
  };
}
function eligible(
  pr: ReturnType<typeof snapshot>,
  input: Parameters<typeof verifyGithubChange>[0],
): boolean {
  return (
    pr.open &&
    (input.draft === undefined || pr.draft === input.draft) &&
    !pr.merged &&
    pr.head === input.expectedHead &&
    pr.branch === input.expectedBranch &&
    pr.baseBranch === input.baseBranch &&
    pr.headRepo.toLowerCase() === input.repository.toLowerCase() &&
    pr.baseRepo.toLowerCase() === input.repository.toLowerCase()
  );
}

/** Parse only a canonical PR link belonging to the configured repository. */
export function githubPullRequestNumber(
  value: unknown,
  repository: string,
): number | undefined {
  if (typeof value !== 'string') return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?$/.exec(
    url.pathname,
  );
  if (
    url.origin !== 'https://github.com' ||
    url.username ||
    url.password ||
    !match ||
    `${match[1]}/${match[2]}`.toLowerCase() !== repository.toLowerCase()
  )
    return undefined;
  const number = Number(match[3]);
  return Number.isSafeInteger(number) ? number : undefined;
}
