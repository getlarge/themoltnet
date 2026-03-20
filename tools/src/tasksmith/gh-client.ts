import { execFileText } from '@moltnet/context-evals/process';

// ── Constants ──

const TEST_FILE_PATTERNS = [
  /\.test\.tsx?$/,
  /\.e2e\.test\.tsx?$/,
  /\/__tests__\//,
];

const RETRY_DELAYS_MS = [1000, 3000, 9000]; // exponential backoff
const PACE_DELAY_MS = 200;
let repoRootPromise: Promise<string> | undefined;

// ── Types (raw GH API shapes) ──

interface GhPrListItem {
  number: number;
  title: string;
  body: string;
  baseRefName: string;
  headRefOid: string;
  mergeCommit: { oid: string } | null;
  labels: Array<{ name: string }>;
  closedAt: string;
  files?: Array<{ path: string }>;
}

interface GhPrFilesResponse {
  files: Array<{ path: string }>;
}

// ── Helpers ──

export function parseLinkedIssue(body: string): number | null {
  const match = body.match(/(?:Fixes|Closes|Resolves)\s+#(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERNS.some((p) => p.test(path));
}

function isDocsOnly(files: Array<{ path: string }>): boolean {
  return files.every(
    (f) => f.path.endsWith('.md') || f.path.startsWith('docs/'),
  );
}

export function filterCandidatePrs(prs: GhPrListItem[]): GhPrListItem[] {
  return prs.filter((pr) => {
    if (!pr.mergeCommit) return false;
    if (pr.title.startsWith('chore: release')) return false;
    const files = pr.files ?? [];
    if (isDocsOnly(files)) return false;
    if (!files.some((f) => isTestFile(f.path))) return false;
    return true;
  });
}

// ── GH CLI wrappers with retry ──

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable =
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('500') ||
        msg.includes('rate limit');

      if (!isRetryable || attempt === RETRY_DELAYS_MS.length) {
        throw err;
      }

      const delay =
        RETRY_DELAYS_MS[attempt] + Math.random() * RETRY_DELAYS_MS[attempt];
      // eslint-disable-next-line no-console
      console.warn(
        `[gh-client] ${label} attempt ${attempt + 1} failed: ${msg}, retrying in ${Math.round(delay)}ms`,
      );
      await sleep(delay);
    }
  }
  throw new Error('unreachable');
}

async function getRepoRoot(): Promise<string> {
  repoRootPromise ??= execFileText('git', [
    'rev-parse',
    '--show-toplevel',
  ]).then((out) => out.trim());
  return repoRootPromise;
}

export async function ghPrList(limit: number): Promise<GhPrListItem[]> {
  return withRetry(async () => {
    const json = await execFileText('gh', [
      'pr',
      'list',
      '--state',
      'merged',
      '--limit',
      String(limit),
      '--json',
      'number,title,body,baseRefName,headRefOid,mergeCommit,labels,closedAt',
    ]);
    return JSON.parse(json) as GhPrListItem[];
  }, `pr list --limit ${limit}`);
}

export async function ghPrFiles(
  prNumber: number,
): Promise<Array<{ path: string }>> {
  return withRetry(async () => {
    const json = await execFileText('gh', [
      'pr',
      'view',
      String(prNumber),
      '--json',
      'files',
    ]);
    const parsed = JSON.parse(json) as GhPrFilesResponse;
    return parsed.files ?? [];
  }, `pr view ${prNumber} files`);
}

export async function ghIssueBody(issueNumber: number): Promise<string> {
  return withRetry(async () => {
    const json = await execFileText('gh', [
      'issue',
      'view',
      String(issueNumber),
      '--json',
      'body',
    ]);
    const parsed = JSON.parse(json) as { body: string };
    return parsed.body ?? '';
  }, `issue view ${issueNumber}`);
}

export async function gitMergeBase(
  ref1: string,
  ref2: string,
): Promise<string> {
  const out = await execFileText('git', ['merge-base', ref1, ref2]);
  return out.trim();
}

/** Get the first parent of a merge commit — the pre-merge main state. */
export async function gitFirstParent(mergeCommitOid: string): Promise<string> {
  const out = await execFileText('git', ['rev-parse', `${mergeCommitOid}^1`]);
  return out.trim();
}

/** Fetch a single PR's full metadata (for targeted --prs runs). */
export async function ghPrView(prNumber: number): Promise<GhPrListItem> {
  return withRetry(async () => {
    const json = await execFileText('gh', [
      'pr',
      'view',
      String(prNumber),
      '--json',
      'number,title,body,baseRefName,headRefOid,mergeCommit,labels,closedAt,files',
    ]);
    return JSON.parse(json) as GhPrListItem;
  }, `pr view ${prNumber}`);
}

export async function gitDiff(
  base: string,
  head: string,
  filePath?: string,
): Promise<string> {
  const args = ['diff', base, head];
  if (filePath) args.push('--', filePath);
  const out = await execFileText('git', args, {
    cwd: filePath ? await getRepoRoot() : undefined,
  });
  return out;
}

/** Check if a file exists at a given git ref. */
export async function gitFileExistsAtRef(
  ref: string,
  filePath: string,
): Promise<boolean> {
  try {
    await execFileText('git', ['cat-file', '-e', `${ref}:${filePath}`]);
    return true;
  } catch {
    return false;
  }
}

/** Read a file's content at a given git ref. Returns null if the file doesn't exist. */
export async function gitShowFileAtRef(
  ref: string,
  filePath: string,
): Promise<string | null> {
  try {
    return await execFileText('git', ['show', `${ref}:${filePath}`]);
  } catch {
    return null;
  }
}

export { isTestFile, PACE_DELAY_MS };
