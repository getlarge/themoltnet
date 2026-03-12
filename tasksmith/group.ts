#!/usr/bin/env npx tsx
/**
 * tasksmith/group.ts — Group adjacent commits into multi-commit task candidates.
 *
 * Reads:  tasksmith/candidates/commits.jsonl
 * Writes: tasksmith/candidates/commit-groups.jsonl
 *
 * Usage: npx tsx tasksmith/group.ts
 *
 * Why: Many fixture_already_green rejections happen because the gold fix
 * commit only modifies tests or does cleanup — the actual behavior change
 * landed in an adjacent commit. Grouping recovers these as valid tasks.
 *
 * Strategy:
 * 1. Build a parent→child index from all commits (not just candidates)
 * 2. For each candidate, look backward along its first-parent chain
 * 3. Group when adjacent commits share scope, subsystem, or diary trailer
 * 4. Emit groups of 2-4 commits with fixture_ref = parent(first)
 */

import { exec as execCb } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execCb);

const EXEC_OPTS = { encoding: 'utf8' as const, maxBuffer: 50 * 1024 * 1024 };
const __dirname =
  import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

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

interface CommitGroup {
  group_id: string;
  start_commit_sha: string;
  end_commit_sha: string;
  fixture_ref: string;
  commit_shas: string[];
  subjects: string[];
  has_diary_trailer: boolean;
  diary_entry_ids: string[];
  changed_files: string[];
  family: string;
  secondary_families: string[];
  subsystems: string[];
  confidence: 'high' | 'medium' | 'low';
  grouping_reason: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = join(__dirname, '..');
const CANDIDATES_FILE = join(REPO_ROOT, 'tasksmith/candidates/commits.jsonl');
const OUTPUT_DIR = join(REPO_ROOT, 'tasksmith/candidates');
const OUTPUT_FILE = join(OUTPUT_DIR, 'commit-groups.jsonl');

const MAX_GROUP_SIZE = 4;
const MAX_TIME_GAP_HOURS = 72;

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

interface GitCommitMeta {
  sha: string;
  parent: string;
  subject: string;
  date: string;
  isMerge: boolean;
}

/**
 * Build an index of ALL commits in the repo (not just candidates).
 * We need this to walk parent chains and check for merges between candidates.
 */
async function buildCommitIndex(): Promise<Map<string, GitCommitMeta>> {
  const { stdout } = await exec(
    `git log --format='%H%x09%P%x09%s%x09%aI' --all`,
    EXEC_OPTS,
  );
  const index = new Map<string, GitCommitMeta>();
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    const [sha, parents, subject, date] = line.split('\t');
    const parentList = parents ? parents.split(' ') : [];
    index.set(sha, {
      sha,
      parent: parentList[0] || '',
      subject,
      date,
      isMerge: parentList.length > 1,
    });
  }
  return index;
}

// ---------------------------------------------------------------------------
// Scope extraction
// ---------------------------------------------------------------------------

/**
 * Extract conventional commit scope: "fix(auth): ..." → "auth"
 */
function extractScope(subject: string): string | null {
  const match = subject.match(/^[a-z]+\(([^)]+)\)/);
  return match ? match[1] : null;
}

/**
 * Extract top-level subsystem from file paths: "libs/auth/src/foo.ts" → "libs/auth"
 */
function extractSubsystems(files: string[]): Set<string> {
  const subs = new Set<string>();
  for (const f of files) {
    const parts = f.split('/');
    if (
      parts.length >= 2 &&
      ['apps', 'libs', 'packages', 'cmd'].includes(parts[0])
    ) {
      subs.add(`${parts[0]}/${parts[1]}`);
    }
  }
  return subs;
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

interface GroupingSignal {
  score: number;
  reasons: string[];
}

/**
 * Score how related two adjacent candidates are. Higher = more groupable.
 */
function groupingSignal(
  earlier: CandidateCommit,
  later: CandidateCommit,
): GroupingSignal {
  let score = 0;
  const reasons: string[] = [];

  // Same scope (strongest signal)
  const scopeA = extractScope(earlier.subject);
  const scopeB = extractScope(later.subject);
  if (scopeA && scopeB && scopeA === scopeB) {
    score += 3;
    reasons.push(`same_scope(${scopeA})`);
  }

  // Overlapping subsystems
  const subsA = extractSubsystems(earlier.changed_files);
  const subsB = extractSubsystems(later.changed_files);
  const overlap = [...subsA].filter((s) => subsB.has(s));
  if (overlap.length > 0) {
    score += 2;
    reasons.push(`shared_subsystem(${overlap.join(',')})`);
  }

  // Same or compatible family
  if (earlier.family === later.family) {
    score += 1;
    reasons.push('same_family');
  } else if (
    (earlier.family === 'codegen' || later.family === 'codegen') &&
    (earlier.family !== 'mixed' && later.family !== 'mixed')
  ) {
    // codegen + source family is a natural pairing
    score += 1;
    reasons.push('codegen_pairing');
  }

  // Shared diary entry IDs (very strong signal)
  if (earlier.diary_entry_ids.length > 0 && later.diary_entry_ids.length > 0) {
    const sharedDiary = earlier.diary_entry_ids.filter((id) =>
      later.diary_entry_ids.includes(id),
    );
    if (sharedDiary.length > 0) {
      score += 4;
      reasons.push('shared_diary_entry');
    }
  }

  // Follow-up language in later commit
  const laterLower = later.subject.toLowerCase();
  const followUpPatterns = [
    'fix',
    'regen',
    'typecheck',
    'tests',
    'test',
    'lint',
    'address',
    'cleanup',
    'wiring',
    'align',
    'update',
    'correct',
  ];
  if (
    followUpPatterns.some(
      (p) =>
        laterLower.includes(p) &&
        scopeB &&
        scopeA === scopeB,
    )
  ) {
    score += 1;
    reasons.push('follow_up_language');
  }

  // Overlapping changed files
  const filesA = new Set(earlier.changed_files);
  const sharedFiles = later.changed_files.filter((f) => filesA.has(f));
  if (sharedFiles.length > 0) {
    score += 1;
    reasons.push(`shared_files(${sharedFiles.length})`);
  }

  // Time proximity
  const timeA = new Date(earlier.date).getTime();
  const timeB = new Date(later.date).getTime();
  const hoursDiff = Math.abs(timeB - timeA) / (1000 * 60 * 60);
  if (hoursDiff < 2) {
    score += 1;
    reasons.push('close_timestamps');
  }

  return { score, reasons };
}

/**
 * Check if there are any merge commits between two commits on the first-parent chain.
 * Merges are hard boundaries — don't group across them.
 */
function hasMergeBetween(
  startSha: string,
  endSha: string,
  commitIndex: Map<string, GitCommitMeta>,
): boolean {
  let current = endSha;
  const visited = new Set<string>();

  while (current && current !== startSha && !visited.has(current)) {
    visited.add(current);
    const commit = commitIndex.get(current);
    if (!commit) return true; // unknown commit = treat as boundary
    if (commit.isMerge) return true;
    current = commit.parent;
  }

  return false;
}

/**
 * Check time gap between two commits.
 */
function timeGapHours(dateA: string, dateB: string): number {
  return (
    Math.abs(new Date(dateA).getTime() - new Date(dateB).getTime()) /
    (1000 * 60 * 60)
  );
}

// ---------------------------------------------------------------------------
// Family classification for groups
// ---------------------------------------------------------------------------

/**
 * Family rules mirrored from harvest.ts for group-level classification.
 */
/**
 * Related families that naturally co-occur in the same task.
 * When a group spans two related families, pick the more specific one.
 */
const RELATED_FAMILIES: Record<string, string[]> = {
  'rest-api-route': ['service-logic', 'workflow', 'auth-permissions', 'database-migration'],
  'service-logic': ['rest-api-route', 'database-migration'],
  'mcp-tooling': ['rest-api-route', 'service-logic'],
  'auth-permissions': ['rest-api-route'],
  'workflow': ['rest-api-route', 'service-logic', 'database-migration'],
  'sdk-package': ['rest-api-route'],
  'cli-package': ['sdk-package'],
};

function classifyGroupFamily(
  _changedFiles: string[],
  memberFamilies: string[],
): { primary: string; secondary: string[] } {
  const nonMixed = memberFamilies.filter((f) => f !== 'mixed');
  const uniqueFamilies = [...new Set(nonMixed)];

  // All members agree
  if (uniqueFamilies.length === 1) {
    return { primary: uniqueFamilies[0], secondary: [] };
  }

  // No non-mixed families
  if (uniqueFamilies.length === 0) {
    return { primary: 'mixed', secondary: [] };
  }

  // Codegen pairing: codegen + source family
  if (uniqueFamilies.includes('codegen') && uniqueFamilies.length === 2) {
    const source = uniqueFamilies.find((f) => f !== 'codegen')!;
    return { primary: source, secondary: ['codegen'] };
  }

  // Count occurrences
  const counts = new Map<string, number>();
  for (const f of nonMixed) {
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [topFamily] = sorted[0];

  // Check if all families are related to the top family
  const related = RELATED_FAMILIES[topFamily] || [];
  const allRelated = uniqueFamilies.every(
    (f) => f === topFamily || related.includes(f),
  );

  if (allRelated) {
    const secondary = uniqueFamilies.filter((f) => f !== topFamily);
    return { primary: topFamily, secondary };
  }

  // Check if second-place family considers top as related
  if (sorted.length >= 2) {
    const [secondFamily] = sorted[1];
    const secondRelated = RELATED_FAMILIES[secondFamily] || [];
    if (secondRelated.includes(topFamily) || related.includes(secondFamily)) {
      const secondary = uniqueFamilies.filter((f) => f !== topFamily);
      return { primary: topFamily, secondary };
    }
  }

  // Truly unrelated — use most frequent, mark others as secondary
  const secondary = sorted.slice(1).map(([f]) => f);
  return { primary: topFamily, secondary };
}

// ---------------------------------------------------------------------------
// Main grouping algorithm
// ---------------------------------------------------------------------------

function buildGroups(
  candidates: CandidateCommit[],
  commitIndex: Map<string, GitCommitMeta>,
): CommitGroup[] {
  // Index candidates by SHA for O(1) lookup
  const candidateBySha = new Map<string, CandidateCommit>();
  for (const c of candidates) {
    candidateBySha.set(c.commit_sha, c);
  }

  // Build parent→children map for candidates only
  const childrenOf = new Map<string, CandidateCommit[]>();
  for (const c of candidates) {
    const existing = childrenOf.get(c.parent_sha) || [];
    existing.push(c);
    childrenOf.set(c.parent_sha, existing);
  }

  // Track which candidates are already consumed by a group
  const consumed = new Set<string>();
  const groups: CommitGroup[] = [];

  // Sort candidates by date ascending (oldest first) so we build chains forward
  const sorted = [...candidates].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  for (const seed of sorted) {
    if (consumed.has(seed.commit_sha)) continue;

    // Try to extend this seed into a group by following the parent chain
    const chain: CandidateCommit[] = [seed];
    let bestSignal: GroupingSignal = { score: 0, reasons: [] };

    // Look backward: is the parent also a candidate?
    let current = seed;
    while (chain.length < MAX_GROUP_SIZE) {
      const parent = candidateBySha.get(current.parent_sha);
      if (!parent) break;
      if (consumed.has(parent.commit_sha)) break;

      // Don't group across merges
      if (hasMergeBetween(parent.commit_sha, current.commit_sha, commitIndex)) {
        break;
      }

      // Don't group across large time gaps
      if (timeGapHours(parent.date, current.date) > MAX_TIME_GAP_HOURS) break;

      const signal = groupingSignal(parent, current);
      if (signal.score < 3) break; // threshold: need at least scope+subsystem match

      chain.unshift(parent);
      if (signal.score > bestSignal.score) bestSignal = signal;
      current = parent;
    }

    // Look forward: are there children that extend the chain?
    current = seed;
    while (chain.length < MAX_GROUP_SIZE) {
      const children = childrenOf.get(current.commit_sha);
      if (!children || children.length === 0) break;

      // Take the best-matching child
      let bestChild: CandidateCommit | null = null;
      let bestChildSignal: GroupingSignal = { score: 0, reasons: [] };

      for (const child of children) {
        if (consumed.has(child.commit_sha)) continue;
        if (hasMergeBetween(current.commit_sha, child.commit_sha, commitIndex)) {
          continue;
        }
        if (timeGapHours(current.date, child.date) > MAX_TIME_GAP_HOURS) {
          continue;
        }

        const signal = groupingSignal(current, child);
        if (signal.score > bestChildSignal.score) {
          bestChild = child;
          bestChildSignal = signal;
        }
      }

      if (!bestChild || bestChildSignal.score < 3) break;

      chain.push(bestChild);
      if (bestChildSignal.score > bestSignal.score) bestSignal = bestChildSignal;
      current = bestChild;
    }

    // Only emit groups of 2+ commits
    if (chain.length < 2) continue;

    // Mark all members as consumed
    for (const c of chain) consumed.add(c.commit_sha);

    // Build the group
    const allFiles = [...new Set(chain.flatMap((c) => c.changed_files))];
    const allDiaryIds = [
      ...new Set(chain.flatMap((c) => c.diary_entry_ids)),
    ];
    const allSubsystems = [
      ...new Set(chain.flatMap((c) => c.subsystems)),
    ].sort();
    const memberFamilies = chain.map((c) => c.family);
    const { primary, secondary } = classifyGroupFamily(allFiles, memberFamilies);

    // Fixture = parent of the earliest commit in the chain
    const earliest = chain[0];
    const latest = chain[chain.length - 1];

    // Confidence: high if any member has tests, otherwise medium
    const hasTests = allFiles.some(
      (f) => f.includes('.test.ts') || f.includes('__tests__/'),
    );
    const confidence: 'high' | 'medium' | 'low' = primary === 'mixed'
      ? 'low'
      : hasTests
        ? 'high'
        : 'medium';

    const slugBase = latest.subject
      .replace(/^[a-z]+\([^)]*\):\s*/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '');
    const groupId = `group-${primary}-${slugBase}-${latest.commit_sha.slice(0, 8)}`;

    groups.push({
      group_id: groupId,
      start_commit_sha: earliest.commit_sha,
      end_commit_sha: latest.commit_sha,
      fixture_ref: earliest.parent_sha,
      commit_shas: chain.map((c) => c.commit_sha),
      subjects: chain.map((c) => c.subject),
      has_diary_trailer: chain.some((c) => c.has_diary_trailer),
      diary_entry_ids: allDiaryIds,
      changed_files: allFiles,
      family: primary,
      secondary_families: secondary,
      subsystems: allSubsystems,
      confidence,
      grouping_reason: bestSignal.reasons.join(', '),
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let raw: string;
  try {
    raw = (await readFile(CANDIDATES_FILE, 'utf8')).trim();
  } catch {
    console.error('[group] commits.jsonl not found — run harvest.ts first');
    process.exit(1);
  }

  if (!raw) {
    console.error('[group] commits.jsonl is empty');
    process.exit(0);
  }

  const candidates: CandidateCommit[] = raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  console.error(`[group] Loaded ${candidates.length} candidates`);
  console.error('[group] Building commit index...');
  const commitIndex = await buildCommitIndex();
  console.error(`[group] Indexed ${commitIndex.size} commits`);

  const groups = buildGroups(candidates, commitIndex);

  // Stats
  const consumedCount = groups.reduce((sum, g) => sum + g.commit_shas.length, 0);
  const familyCounts = new Map<string, number>();
  for (const g of groups) {
    familyCounts.set(g.family, (familyCounts.get(g.family) || 0) + 1);
  }

  console.error(`[group] Found ${groups.length} groups (${consumedCount} commits consumed)`);
  console.error('[group] Group sizes:');
  const sizeCounts = new Map<number, number>();
  for (const g of groups) {
    const size = g.commit_shas.length;
    sizeCounts.set(size, (sizeCounts.get(size) || 0) + 1);
  }
  for (const [size, count] of [...sizeCounts.entries()].sort((a, b) => a[0] - b[0])) {
    console.error(`[group]   ${size}-commit: ${count}`);
  }
  console.error('[group] Family breakdown:');
  for (const [fam, count] of [...familyCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.error(`[group]   ${fam}: ${count}`);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const jsonl = groups.map((g) => JSON.stringify(g)).join('\n') + '\n';
  await writeFile(OUTPUT_FILE, jsonl, 'utf8');

  console.error(`[group] Wrote ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error('[group] Fatal:', err);
  process.exit(1);
});
