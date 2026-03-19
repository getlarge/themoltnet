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
  extractTask,
  normalizeTestCommand,
  repairCommandsForCandidate,
} from './task-extractor.js';
import type {
  CriteriaItem,
  HarvestOptions,
  VerificationResult,
} from './types.js';
import {
  cleanupAllWorktrees,
  startE2eStack,
  stopE2eStack,
  verifyDockerCommands,
  verifyTask,
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
    concurrency: { type: 'string', default: '1' },
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
  --student-provider <name>  AI provider for extraction (default: codex-agent-sdk)
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
  debug: values.debug ?? false,
};

// ── Helpers ──

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
    const pr = parseInt(file.replace('.json', ''), 10);
    if (isNaN(pr)) continue;
    if (prFilter?.length && !prFilter.includes(pr)) continue;

    const raw = JSON.parse(
      await readFile(resolve(tasksDir, file), 'utf8'),
    ) as TasksmithTask;
    const task: TasksmithTask = {
      ...raw,
      fail_to_pass: raw.fail_to_pass.map(normalizeTestCommand),
      pass_to_pass: raw.pass_to_pass.map(normalizeTestCommand),
    };

    let criteria: CriteriaItem[] = [];
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

    results.push({ pr, task, criteria });
  }

  return results.sort((a, b) => b.pr - a.pr);
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

  // Jump directly to Phase 3
  let verified = 0;
  let failed = 0;
  const dockerPending: Array<{
    pr: number;
    task: TasksmithTask;
    criteria: CriteriaItem[];
    deferred: NonNullable<VerificationResult['deferredDockerCommands']>;
  }> = [];

  console.log(
    `\n[harvest] Phase 3a: Unit test verification for ${extracted.length} tasks...`,
  );

  try {
    for (const { pr, task, criteria } of extracted) {
      const verification = await verifyTask(task, pr, {
        debug: options.debug ?? false,
        skipDocker: true,
      });

      if (
        verification.status === 'unit_verified' &&
        verification.deferredDockerCommands
      ) {
        console.log(
          `[verify] PR #${pr}: unit tests passed, Docker commands deferred`,
        );
        dockerPending.push({
          pr,
          task,
          criteria,
          deferred: verification.deferredDockerCommands,
        });
      } else if (verification.status === 'verified') {
        verified++;
        console.log(`[verify] PR #${pr}: VERIFIED (no Docker deps)`);
        await writeVerifiedTask(repoRoot, task, criteria, verification);
      } else {
        failed++;
        console.log(
          `[verify] PR #${pr}: ${verification.status} — ${verification.skipReason ?? ''}`,
        );
        await writeVerifiedTask(repoRoot, task, criteria, verification);
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
            console.log(`[verify] PR #${pr}: VERIFIED (unit + Docker)`);
          } else {
            failed++;
            console.log(
              `[verify] PR #${pr}: ${finalVerification.status} — ${finalVerification.skipReason ?? ''}`,
            );
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
    const result = await extractTask(candidate, ai, repoRoot);
    if ('skipReason' in result) {
      console.log(
        `[extract] PR #${candidate.number}: skipped — ${result.skipReason}`,
      );
      skipped.push({ pr: candidate.number, reason: result.skipReason });
    } else {
      console.log(
        `[extract] PR #${candidate.number}: viable (${result.task.fail_to_pass.length} fail_to_pass, ${result.criteria.length} criteria)`,
      );
      extracted.push({ pr: candidate.number, ...result });
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

// Phase 3: Verification (two-phase: unit tests first, then Docker batch)
let verified = 0;
let failed = 0;

if (!options.skipVerify && extracted.length > 0) {
  console.log(
    `\n[harvest] Phase 3a: Unit test verification for ${extracted.length} tasks...`,
  );

  const dockerPending: Array<{
    pr: number;
    task: TasksmithTask;
    criteria: CriteriaItem[];
    deferred: NonNullable<VerificationResult['deferredDockerCommands']>;
  }> = [];

  try {
    for (const { pr, task, criteria } of extracted) {
      const verification = await verifyTask(task, pr, {
        debug: options.debug ?? false,
        skipDocker: true,
      });

      if (
        verification.status === 'unit_verified' &&
        verification.deferredDockerCommands
      ) {
        console.log(
          `[verify] PR #${pr}: unit tests passed, Docker commands deferred`,
        );
        dockerPending.push({
          pr,
          task,
          criteria,
          deferred: verification.deferredDockerCommands,
        });
      } else if (verification.status === 'verified') {
        verified++;
        console.log(`[verify] PR #${pr}: VERIFIED (no Docker deps)`);
        await writeVerifiedTask(repoRoot, task, criteria, verification);
      } else {
        failed++;
        console.log(
          `[verify] PR #${pr}: ${verification.status} — ${verification.skipReason ?? ''}`,
        );
        await writeVerifiedTask(repoRoot, task, criteria, verification);
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
            console.log(`[verify] PR #${pr}: VERIFIED (unit + Docker)`);
          } else {
            failed++;
            console.log(
              `[verify] PR #${pr}: ${finalVerification.status} — ${finalVerification.skipReason ?? ''}`,
            );
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
