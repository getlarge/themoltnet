#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { TasksmithTask } from '@moltnet/context-evals';
import type { AIProvider } from '@moltnet/context-evals/pipeline-shared';
import {
  buildAI,
  resolveRepoRoot,
  str,
} from '@moltnet/context-evals/pipeline-shared';

import { discoverCandidates, saveHarvestState } from './pr-discovery.js';
import {
  extractTasks,
  normalizeTestCommand,
  repairCommandsForCandidate,
} from './task-extractor.js';
import type {
  CriteriaItem,
  HarvestOptions,
  VerificationResult,
} from './types.js';
import type { TaskGroupItem } from './verify.js';
import {
  cleanupAllWorktrees,
  cleanupPrArtifacts,
  startE2eStack,
  stopE2eStack,
  verifyDockerCommands,
  verifyTaskGroup,
  writeVerifiedTask,
} from './verify.js';

// ── CLI ──

const { values } = parseArgs({
  options: {
    prs: { type: 'string', short: 'p' },
    force: { type: 'boolean', default: false },
    'skip-verify': { type: 'boolean', default: false },
    'verify-only': { type: 'boolean', default: false },
    'student-provider': { type: 'string', default: 'claude-agent-sdk' },
    'student-model': { type: 'string' },
    concurrency: { type: 'string', default: '3' },
    debug: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
Usage: pnpm --filter @moltnet/tools tasksmith:harvest [options]

Options:
  --prs, -p <numbers>       Comma-separated PR numbers to process
  --force                    Re-process PRs already in state.json
  --skip-verify              Run extraction only, skip verification
  --verify-only              Verify already-extracted tasks (reads tasksmith/candidates/tasks/)
  --student-provider <name>  AI provider for extraction (default: claude-agent-sdk)
  --student-model <model>    Model for extraction
  --debug                    Preserve worktrees on failure
  -h, --help                 Show this help
`);
  process.exit(0);
}

const options: HarvestOptions = {
  prs: values.prs
    ? values.prs
        .split(',')
        .map((n) => parseInt(n.trim(), 10))
        .filter(Boolean)
    : undefined,
  force: values.force ?? false,
  skipVerify: values['skip-verify'] ?? false,
  verifyOnly: values['verify-only'] ?? false,
  studentProvider: str(values['student-provider']) || 'claude-agent-sdk',
  studentModel: values['student-model']
    ? str(values['student-model'])
    : undefined,
  concurrency: parseInt(str(values.concurrency) || '3', 10),
  debug: values.debug ?? false,
};

// ── Helpers ──

/** Parse PR number from task filenames like "279-0.json" or legacy "279.json" */
function parsePrFromFilename(filename: string): number | null {
  const base = filename.replace('.json', '');
  // New format: "279-0", "279-1" — extract the PR number before the dash-index
  const multiMatch = base.match(/^(\d+)-\d+$/);
  if (multiMatch) return parseInt(multiMatch[1], 10);
  // Legacy format: "279"
  const legacyMatch = base.match(/^(\d+)$/);
  if (legacyMatch) return parseInt(legacyMatch[1], 10);
  return null;
}

async function loadExtractedTasks(
  root: string,
  prFilter?: number[],
): Promise<
  Array<{ pr: number; task: TasksmithTask; criteria: CriteriaItem[] }>
> {
  const tasksDir = resolve(root, 'tasksmith', 'candidates', 'tasks');
  const files = await readdir(tasksDir);
  const results: Array<{
    pr: number;
    task: TasksmithTask;
    criteria: CriteriaItem[];
  }> = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const pr = parsePrFromFilename(file);
    if (pr === null) continue;
    if (prFilter?.length && !prFilter.includes(pr)) continue;

    const raw = JSON.parse(
      await readFile(resolve(tasksDir, file), 'utf8'),
    ) as TasksmithTask;
    const task: TasksmithTask = {
      ...raw,
      fail_to_pass: raw.fail_to_pass.map(normalizeTestCommand),
      pass_to_pass: raw.pass_to_pass.map(normalizeTestCommand),
    };

    // Criteria dir uses task_id (e.g., "pr-279-0") not just PR number
    let criteria: CriteriaItem[] = [];
    try {
      criteria = JSON.parse(
        await readFile(
          resolve(root, 'evals', task.task_id, 'criteria.json'),
          'utf8',
        ),
      ) as CriteriaItem[];
    } catch {
      // Also try legacy path (evals/pr-279/)
      try {
        criteria = JSON.parse(
          await readFile(
            resolve(root, 'evals', `pr-${pr}`, 'criteria.json'),
            'utf8',
          ),
        ) as CriteriaItem[];
      } catch {
        // criteria may not exist for all tasks
      }
    }

    results.push({ pr, task, criteria });
  }

  return results.sort((a, b) => b.pr - a.pr);
}

// ── Concurrency helper ──

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// ── Group tasks by PR ──

function groupByPr(
  tasks: Array<{ pr: number; task: TasksmithTask; criteria: CriteriaItem[] }>,
): Map<number, TaskGroupItem[]> {
  const groups = new Map<number, TaskGroupItem[]>();
  for (const { pr, task, criteria } of tasks) {
    const group = groups.get(pr) ?? [];
    group.push({ task, criteria });
    groups.set(pr, group);
  }
  return groups;
}

// ── Main ──

const t0 = performance.now();
const repoRoot = await resolveRepoRoot();

console.log('\n╔═══════════════════════════════════════════════╗');
console.log('║     PR-based Tasksmith Harvester              ║');
console.log('╚═══════════════════════════════════════════════╝\n');

// ── Verify-only mode ──
if (options.verifyOnly) {
  const extracted = await loadExtractedTasks(repoRoot, options.prs);
  const { candidates: candidateMetadata } = await discoverCandidates(repoRoot, {
    prs: extracted.map(({ pr }) => pr),
    force: true,
  });
  const candidateByPr = new Map(candidateMetadata.map((c) => [c.number, c]));

  for (const item of extracted) {
    const candidate = candidateByPr.get(item.pr);
    if (!candidate) continue;
    item.task.fail_to_pass = await repairCommandsForCandidate(
      item.task.fail_to_pass,
      candidate,
    );
    item.task.pass_to_pass = await repairCommandsForCandidate(
      item.task.pass_to_pass,
      candidate,
    );
  }

  console.log(
    `[harvest] Verify-only mode: ${extracted.length} tasks loaded from disk`,
  );

  if (extracted.length === 0) {
    console.log('[harvest] No tasks to verify.');
    process.exit(0);
  }

  // Jump directly to Phase 3 — grouped by PR, concurrent across PRs
  let verified = 0;
  let failed = 0;
  const dockerPending: Array<{
    pr: number;
    task: TasksmithTask;
    criteria: CriteriaItem[];
    deferred: NonNullable<VerificationResult['deferredDockerCommands']>;
  }> = [];

  const groups = groupByPr(extracted);
  const concurrency = parseInt(str(values.concurrency) || '3', 10);
  console.log(
    `\n[harvest] Phase 3a: Unit test verification for ${extracted.length} tasks ` +
      `(${groups.size} PRs, concurrency=${concurrency})...`,
  );

  try {
    const prEntries = [...groups.entries()];

    const groupResults = await mapConcurrent(
      prEntries,
      concurrency,
      async ([pr, items]) => {
        console.log(`[verify] PR #${pr}: verifying ${items.length} task(s)...`);
        return verifyTaskGroup(pr, items, {
          debug: options.debug ?? false,
          skipDocker: true,
        });
      },
    );

    for (const groupResult of groupResults) {
      for (const { task, criteria, verification } of groupResult.results) {
        if (
          verification.status === 'unit_verified' &&
          verification.deferredDockerCommands
        ) {
          dockerPending.push({
            pr: groupResult.pr,
            task,
            criteria,
            deferred: verification.deferredDockerCommands,
          });
        } else if (verification.status === 'verified') {
          verified++;
          await writeVerifiedTask(repoRoot, task, criteria, verification);
        } else {
          failed++;
          await writeVerifiedTask(repoRoot, task, criteria, verification);
        }
      }
    }

    if (dockerPending.length > 0) {
      console.log(
        `\n[harvest] Phase 3b: Docker verification for ${dockerPending.length} tasks...`,
      );
      await startE2eStack(repoRoot);
      try {
        for (const { pr, task, criteria, deferred } of dockerPending) {
          console.log(
            `[verify] PR #${pr}: running Docker-dependent commands...`,
          );
          const dockerResult = await verifyDockerCommands(
            task,
            deferred,
            options.debug ?? false,
          );
          const finalVerification: VerificationResult = {
            pr,
            status: dockerResult.status,
            redCheck: dockerResult.redCheck,
            greenCheck: dockerResult.greenCheck,
            regressionCheck: dockerResult.regressionCheck,
            skipReason: dockerResult.skipReason,
          };
          if (finalVerification.status === 'verified') {
            verified++;
          } else {
            failed++;
          }
          await writeVerifiedTask(repoRoot, task, criteria, finalVerification);
        }
      } finally {
        await stopE2eStack(repoRoot);
      }
    }
  } finally {
    if (!options.debug) await cleanupAllWorktrees();
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log('\n═══════════════════════════════════════════════');
  console.log('  VERIFY-ONLY SUMMARY');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Tasks:     ${extracted.length}`);
  console.log(`  PRs:       ${groups.size}`);
  console.log(`  Verified:  ${verified}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Deferred:  ${dockerPending.length}`);
  console.log(`  Time:      ${elapsed}s`);
  console.log('═══════════════════════════════════════════════');
  process.exit(0);
}

// ── Normal harvest mode ──

const ai = buildAI({
  provider: options.studentProvider as AIProvider,
  model: options.studentModel,
});

// Phase 1: Discovery
const { candidates, state } = await discoverCandidates(repoRoot, options);

if (candidates.length === 0) {
  console.log('[harvest] No candidates to process.');
  process.exit(0);
}

// Phase 2: Extraction
console.log(`\n[harvest] Extracting tasks from ${candidates.length} PRs...`);

const extracted: Array<{
  pr: number;
  task: TasksmithTask;
  criteria: CriteriaItem[];
}> = [];
const skipped: Array<{ pr: number; reason: string }> = [];

for (const candidate of candidates) {
  console.log(`[extract] PR #${candidate.number}: ${candidate.title}`);
  try {
    const result = await extractTasks(candidate, ai, repoRoot);
    if ('skipReason' in result) {
      console.log(
        `[extract] PR #${candidate.number}: skipped — ${result.skipReason}`,
      );
      skipped.push({ pr: candidate.number, reason: result.skipReason });
    } else {
      const count = result.tasks.length;
      const ftpTotal = result.tasks.reduce(
        (sum, t) => sum + t.task.fail_to_pass.length,
        0,
      );
      console.log(
        `[extract] PR #${candidate.number}: viable (${count} task${count > 1 ? 's' : ''}, ${ftpTotal} fail_to_pass)`,
      );
      // Clean up stale artifacts from previous extractions (e.g., PR went
      // from 5 sub-tasks to 3 — remove old 279-3.json, 279-4.json).
      await cleanupPrArtifacts(repoRoot, candidate.number);
      for (const item of result.tasks) {
        extracted.push({ pr: candidate.number, ...item });
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[extract] PR #${candidate.number}: error — ${msg}`);
    skipped.push({ pr: candidate.number, reason: msg });
  }
  if (!state.processed_prs.includes(candidate.number)) {
    state.processed_prs.push(candidate.number);
  }
}

// Phase 3: Verification (grouped by PR, concurrent across PRs)
let verified = 0;
let failed = 0;

if (!options.skipVerify && extracted.length > 0) {
  const groups = groupByPr(extracted);
  const concurrency = options.concurrency ?? 3;
  console.log(
    `\n[harvest] Phase 3a: Unit test verification for ${extracted.length} tasks ` +
      `(${groups.size} PRs, concurrency=${concurrency})...`,
  );

  const dockerPending: Array<{
    pr: number;
    task: TasksmithTask;
    criteria: CriteriaItem[];
    deferred: NonNullable<VerificationResult['deferredDockerCommands']>;
  }> = [];

  try {
    const prEntries = [...groups.entries()];

    const groupResults = await mapConcurrent(
      prEntries,
      concurrency,
      async ([pr, items]) => {
        console.log(`[verify] PR #${pr}: verifying ${items.length} task(s)...`);
        return verifyTaskGroup(pr, items, {
          debug: options.debug ?? false,
          skipDocker: true,
        });
      },
    );

    for (const groupResult of groupResults) {
      for (const { task, criteria, verification } of groupResult.results) {
        if (
          verification.status === 'unit_verified' &&
          verification.deferredDockerCommands
        ) {
          dockerPending.push({
            pr: groupResult.pr,
            task,
            criteria,
            deferred: verification.deferredDockerCommands,
          });
        } else if (verification.status === 'verified') {
          verified++;
          await writeVerifiedTask(repoRoot, task, criteria, verification);
        } else {
          failed++;
          await writeVerifiedTask(repoRoot, task, criteria, verification);
        }
      }
    }

    // Phase 3b: Docker verification batch (serial)
    if (dockerPending.length > 0) {
      console.log(
        `\n[harvest] Phase 3b: Docker verification for ${dockerPending.length} tasks...`,
      );
      await startE2eStack(repoRoot);

      try {
        for (const { pr, task, criteria, deferred } of dockerPending) {
          console.log(
            `[verify] PR #${pr}: running Docker-dependent commands...`,
          );
          const dockerResult = await verifyDockerCommands(
            task,
            deferred,
            options.debug ?? false,
          );

          const finalVerification: VerificationResult = {
            pr,
            status: dockerResult.status,
            redCheck: dockerResult.redCheck,
            greenCheck: dockerResult.greenCheck,
            regressionCheck: dockerResult.regressionCheck,
            skipReason: dockerResult.skipReason,
          };

          if (finalVerification.status === 'verified') {
            verified++;
          } else {
            failed++;
          }
          await writeVerifiedTask(repoRoot, task, criteria, finalVerification);
        }
      } finally {
        await stopE2eStack(repoRoot);
      }
    }
  } finally {
    if (!options.debug) await cleanupAllWorktrees();
  }
} else if (options.skipVerify) {
  console.log('\n[harvest] Skipping verification (--skip-verify)');
  for (const { pr, task, criteria } of extracted) {
    const unverified: VerificationResult = {
      pr,
      status: 'extracted_unverified',
    };
    await writeVerifiedTask(repoRoot, task, criteria, unverified);
  }
}

// Save state
state.last_run = new Date().toISOString();
await saveHarvestState(resolve(repoRoot, 'tasksmith', 'state.json'), state);

// Summary
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log('\n═══════════════════════════════════════════════');
console.log('  HARVEST SUMMARY');
console.log('═══════════════════════════════════════════════');
console.log(`  Candidates:  ${candidates.length}`);
console.log(`  Extracted:   ${extracted.length}`);
console.log(`  Skipped:     ${skipped.length}`);
console.log(`  Verified:    ${verified}`);
console.log(`  Failed:      ${failed}`);
console.log(`  Time:        ${elapsed}s`);
console.log('═══════════════════════════════════════════════');
