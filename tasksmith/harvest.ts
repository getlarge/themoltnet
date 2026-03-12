#!/usr/bin/env npx tsx
/**
 * tasksmith/harvest.ts — Extract candidate commits from git history.
 *
 * Writes: tasksmith/candidates/commits.jsonl
 * Usage:  npx tsx tasksmith/harvest.ts
 */

import { exec as execCb } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execCb);

const EXEC_OPTS = { encoding: 'utf8' as const, maxBuffer: 50 * 1024 * 1024 };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CandidateCommit {
  commit_sha: string;
  parent_sha: string;
  subject: string;
  date: string;
  has_diary_trailer: boolean;
  diary_entry_ids: string[];
  changed_files: string[];
  family: string;
  secondary_families: string[];
  subsystems: string[];
  task_shape: 'high' | 'medium' | 'low';
  confidence: 'high' | 'medium' | 'low';
}

interface RawCommit {
  sha: string;
  parent: string;
  subject: string;
  date: string;
}

// ---------------------------------------------------------------------------
// Git helpers (all async)
// ---------------------------------------------------------------------------

async function repoRoot(): Promise<string> {
  const { stdout } = await exec('git rev-parse --show-toplevel', EXEC_OPTS);
  return stdout.trim();
}

async function extractCommits(): Promise<RawCommit[]> {
  const { stdout } = await exec(
    `git log --no-merges --format='%H%x09%P%x09%s%x09%aI' --all`,
    EXEC_OPTS,
  );
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, parents, subject, date] = line.split('\t');
      const parent = parents ? parents.split(' ')[0] : '';
      return { sha, parent, subject, date };
    });
}

async function getChangedFiles(sha: string, parent: string): Promise<string[]> {
  const cmd = parent
    ? `git diff --name-only ${parent}..${sha}`
    : `git diff-tree --no-commit-id --name-only -r ${sha}`;
  try {
    const { stdout } = await exec(cmd, EXEC_OPTS);
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function getCommitBody(sha: string): Promise<string> {
  try {
    const { stdout } = await exec(`git log -1 --format='%B' ${sha}`, EXEC_OPTS);
    return stdout;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

const INCLUDE_PREFIXES = ['fix(', 'feat(', 'test(', 'refactor('];

/**
 * Review-cleanup commit patterns — these are follow-up commits that address
 * code review feedback. They don't represent standalone tasks.
 */
const REVIEW_CLEANUP_PATTERNS = [
  'address review',
  'address findings',
  'address feedback',
  'address pr',
  'address code review',
  'review comment',
  'review feedback',
  'review findings',
  'review issues',
  'code review',
  'copilot review',
  'copilot pr',
  'pr feedback',
  'pr review',
  'nit:',
  'fixup!',
  'squash!',
];

function shouldInclude(subject: string, changedFiles: string[]): boolean {
  const lower = subject.toLowerCase();

  if (lower.startsWith('chore: release')) return false;

  // Exclude review-cleanup commits
  if (REVIEW_CLEANUP_PATTERNS.some((p) => lower.includes(p))) return false;

  const hasPrefix = INCLUDE_PREFIXES.some((p) => lower.startsWith(p));
  const isChoreRegen =
    lower.startsWith('chore(') &&
    (lower.includes('regenerate') || lower.includes('regen'));

  if (!hasPrefix && !isChoreRegen) return false;
  if (changedFiles.length === 0) return false;

  if (changedFiles.every((f) => f.startsWith('docs/') || f.endsWith('.md')))
    return false;
  if (changedFiles.every((f) => f === 'pnpm-lock.yaml')) return false;
  if (changedFiles.every((f) => f.startsWith('evals/'))) return false;

  if (
    (lower.includes('prettier') || lower.includes('format')) &&
    changedFiles.every(
      (f) =>
        f.endsWith('.json') ||
        f.endsWith('.md') ||
        f.endsWith('.yaml') ||
        f.endsWith('.yml'),
    )
  )
    return false;

  return true;
}

// ---------------------------------------------------------------------------
// Diary trailer
// ---------------------------------------------------------------------------

function parseDiaryTrailers(body: string): string[] {
  const ids: string[] = [];
  const re = /MoltNet-Diary:\s*([0-9a-f-]{36})/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

interface FamilyRule {
  name: string;
  test: (file: string) => boolean;
}

const FAMILY_RULES: FamilyRule[] = [
  {
    name: 'rest-api-route',
    test: (f) => f.startsWith('apps/rest-api/src/routes/'),
  },
  {
    name: 'workflow',
    test: (f) => f.startsWith('apps/rest-api/src/workflows/'),
  },
  {
    name: 'service-logic',
    test: (f) =>
      f.startsWith('libs/diary-service/') ||
      f.startsWith('libs/database/src/repositories/'),
  },
  {
    name: 'auth-permissions',
    test: (f) => f.startsWith('libs/auth/'),
  },
  {
    name: 'mcp-tooling',
    test: (f) => f.startsWith('apps/mcp-server/src/'),
  },
  {
    name: 'database-migration',
    test: (f) =>
      f.startsWith('libs/database/drizzle/') ||
      f === 'libs/database/src/schema.ts',
  },
  {
    name: 'sdk-package',
    test: (f) => f.startsWith('libs/sdk/'),
  },
  {
    name: 'cli-package',
    test: (f) => f.startsWith('packages/cli/'),
  },
  {
    name: 'github-agent-package',
    test: (f) => f.startsWith('packages/github-agent/'),
  },
  {
    name: 'observability',
    test: (f) => f.startsWith('libs/observability/'),
  },
  {
    name: 'infra-or-e2e',
    test: (f) =>
      f.startsWith('infra/') ||
      f.startsWith('.github/') ||
      f.startsWith('docker-compose'),
  },
];

interface ClassificationResult {
  primary: string;
  secondary: string[];
}

function classifyFamily(changedFiles: string[]): ClassificationResult {
  const hasOpenapi = changedFiles.some(
    (f) => f === 'apps/rest-api/public/openapi.json',
  );
  const hasGenerated = changedFiles.some(
    (f) =>
      f.startsWith('libs/api-client/src/generated/') ||
      f.startsWith('cmd/moltnet-api-client/'),
  );

  const counts = new Map<string, number>();
  for (const file of changedFiles) {
    // Skip generated/openapi files from family counting — they're handled below
    if (
      file === 'apps/rest-api/public/openapi.json' ||
      file.startsWith('libs/api-client/src/generated/') ||
      file.startsWith('cmd/moltnet-api-client/')
    )
      continue;

    for (const rule of FAMILY_RULES) {
      if (rule.test(file)) {
        counts.set(rule.name, (counts.get(rule.name) || 0) + 1);
        break;
      }
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const secondary: string[] = [];

  // Pure codegen: openapi + generated files, NO source files touching other families
  if (hasOpenapi && hasGenerated && sorted.length === 0) {
    return { primary: 'codegen', secondary: [] };
  }

  // Cross-layer: source files + generated artifacts
  // The primary family is the dominant source family; codegen is secondary
  if (hasOpenapi && hasGenerated && sorted.length > 0) {
    secondary.push('codegen');
  }

  if (sorted.length === 0) return { primary: 'mixed', secondary };

  const [topFamily, topCount] = sorted[0];

  if (sorted.length === 1) return { primary: topFamily, secondary };

  const [, secondCount] = sorted[1];
  if (
    Math.abs(topCount - secondCount) <= 1 &&
    topCount >= 3 &&
    secondCount >= 3
  ) {
    return { primary: 'mixed', secondary };
  }

  // Add runner-up families as secondary
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][1] >= 2) {
      secondary.push(sorted[i][0]);
    }
  }

  return { primary: topFamily, secondary };
}

function deriveSubsystems(changedFiles: string[]): string[] {
  const subsystems = new Set<string>();
  for (const file of changedFiles) {
    const parts = file.split('/');
    if (
      parts.length >= 2 &&
      ['apps', 'libs', 'packages', 'infra', 'cmd'].includes(parts[0])
    ) {
      subsystems.add(`${parts[0]}/${parts[1]}`);
    } else if (parts[0] === 'tools') {
      subsystems.add('tools');
    } else if (file.startsWith('.github')) {
      subsystems.add('.github');
    } else if (file.startsWith('docker-compose')) {
      subsystems.add('docker-compose');
    }
  }
  return [...subsystems].sort();
}

function hasTestChanges(changedFiles: string[]): boolean {
  return changedFiles.some(
    (f) => f.includes('__tests__/') || f.includes('.test.ts'),
  );
}

function assignConfidence(
  family: string,
  changedFiles: string[],
): 'high' | 'medium' | 'low' {
  if (family === 'mixed') return 'low';
  if (hasTestChanges(changedFiles)) return 'high';
  return 'medium';
}

// ---------------------------------------------------------------------------
// Task shape scoring — how likely is this commit to produce a useful task?
// ---------------------------------------------------------------------------

/**
 * Greenfield package prefixes — feat() commits that create entirely new
 * packages are scaffolding, not fixable tasks. They score low.
 */
const SCAFFOLDING_PREFIXES = [
  'libs/sdk/',
  'packages/cli/',
  'packages/github-agent/',
  'packages/legreffier-cli/',
  'libs/design-system/',
  'libs/bootstrap/',
  'libs/context-distill/',
  'apps/landing/',
];

function assignTaskShape(
  subject: string,
  changedFiles: string[],
  hasDiaryTrailer: boolean,
): 'high' | 'medium' | 'low' {
  const lower = subject.toLowerCase();

  // fix() commits are the best task shape — real bugs with real fixes
  if (lower.startsWith('fix(')) return 'high';

  // chore() regen commits are good — deterministic codegen tasks
  if (lower.startsWith('chore(') && /regen/i.test(lower)) return 'high';

  // Diary-linked commits get a boost
  if (hasDiaryTrailer) return 'high';

  // test() adding coverage for existing code is useful
  if (lower.startsWith('test(') && hasTestChanges(changedFiles))
    return 'medium';

  // feat() that creates a whole new package is scaffolding — low value
  if (lower.startsWith('feat(')) {
    const isScaffolding = changedFiles.every((f) =>
      SCAFFOLDING_PREFIXES.some((p) => f.startsWith(p)),
    );
    if (isScaffolding) return 'low';

    // feat() that modifies existing files alongside new ones is more task-shaped
    // but still not as good as fix()
    return 'medium';
  }

  // refactor() is medium — useful if it modifies tests
  if (lower.startsWith('refactor(')) {
    return hasTestChanges(changedFiles) ? 'medium' : 'low';
  }

  return 'medium';
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const root = await repoRoot();
  const outputDir = join(root, 'tasksmith', 'candidates');
  const outputFile = join(outputDir, 'commits.jsonl');

  const allCommits = await extractCommits();
  console.error(`[harvest] Processing ${allCommits.length} commits...`);

  // Phase 1: get changed files in parallel (bottleneck is git diff per commit)
  const changedFilesMap = new Map<string, string[]>();
  await mapConcurrent(allCommits, 20, async (commit) => {
    const files = await getChangedFiles(commit.sha, commit.parent);
    changedFilesMap.set(commit.sha, files);
  });

  // Phase 2: filter
  const filtered = allCommits.filter((c) =>
    shouldInclude(c.subject, changedFilesMap.get(c.sha) || []),
  );

  // Phase 3: get diary trailers + classify in parallel
  const candidates: CandidateCommit[] = [];
  await mapConcurrent(filtered, 20, async (commit) => {
    const changedFiles = changedFilesMap.get(commit.sha) || [];
    const body = await getCommitBody(commit.sha);
    const diaryIds = parseDiaryTrailers(body);
    const hasDiaryTrailer = diaryIds.length > 0;
    const { primary, secondary } = classifyFamily(changedFiles);
    const subsystems = deriveSubsystems(changedFiles);
    const confidence = assignConfidence(primary, changedFiles);
    const taskShape = assignTaskShape(
      commit.subject,
      changedFiles,
      hasDiaryTrailer,
    );

    candidates.push({
      commit_sha: commit.sha,
      parent_sha: commit.parent,
      subject: commit.subject,
      date: commit.date,
      has_diary_trailer: hasDiaryTrailer,
      diary_entry_ids: diaryIds,
      changed_files: changedFiles,
      family: primary,
      secondary_families: secondary,
      subsystems,
      task_shape: taskShape,
      confidence,
    });
  });

  // Sort by date descending for stable output
  candidates.sort((a, b) => b.date.localeCompare(a.date));

  const diaryLinked = candidates.filter((c) => c.has_diary_trailer).length;
  const highShape = candidates.filter((c) => c.task_shape === 'high').length;
  const mediumShape = candidates.filter(
    (c) => c.task_shape === 'medium',
  ).length;
  const lowShape = candidates.filter((c) => c.task_shape === 'low').length;
  console.error(
    `[harvest] Found ${candidates.length} candidates (${diaryLinked} diary-linked)`,
  );
  console.error(
    `[harvest] Task shape: ${highShape} high, ${mediumShape} medium, ${lowShape} low`,
  );

  await mkdir(outputDir, { recursive: true });
  const jsonl = candidates.map((c) => JSON.stringify(c)).join('\n') + '\n';
  await writeFile(outputFile, jsonl, 'utf8');

  console.error('[harvest] Wrote tasksmith/candidates/commits.jsonl');
}

main().catch((err) => {
  console.error('[harvest] Fatal:', err);
  process.exit(1);
});
