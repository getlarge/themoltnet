#!/usr/bin/env npx tsx
/**
 * tasksmith/verify.ts — Verify derived task records via red/green execution.
 *
 * For each task:
 *   1. Create worktree at fixture_ref
 *   2. Run fail_to_pass → require majority (≥50%) to fail
 *   3. Run pass_to_pass on fixture → require all pass
 *   4. Create worktree at gold_fix_ref
 *   5. Run fail_to_pass → require all pass
 *   6. Run pass_to_pass on fix → require all pass
 *   7. Emit verified or rejected with reason
 *
 * Reads:  tasksmith/candidates/tasks/{task_id}.json
 * Writes: tasksmith/verified/{task_id}.json
 *         tasksmith/rejected/{task_id}.json
 *         tasksmith/verify-report.json
 *
 * Resumable: skips tasks whose task record hash matches a previous result.
 *
 * Usage: npx tsx tasksmith/verify.ts [--limit N] [--family F] [--force]
 */

import { exec as execCb } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execCb);

const __dirname =
  import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const EXEC_OPTS = { encoding: 'utf8' as const, maxBuffer: 10 * 1024 * 1024 };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskRecord {
  task_id: string;
  fixture_ref: string;
  gold_fix_ref: string;
  source_commit_ref: string;
  problem_statement: string;
  family: string;
  secondary_families: string[];
  subsystems: string[];
  changed_files: string[];
  fail_to_pass: string[];
  pass_to_pass: string[];
  diary_entry_ids: string[];
  confidence: string;
}

type RejectionReason =
  | 'fixture_already_green'
  | 'fail_to_pass_saturated'
  | 'fix_not_green'
  | 'pass_to_pass_unstable_fixture'
  | 'pass_to_pass_unstable_fix'
  | 'command_missing'
  | 'timeout'
  | 'setup_failed';

type CommandOutcome =
  | 'pass'
  | 'fail'
  | 'missing_path'
  | 'missing_tool'
  | 'timeout'
  | 'infra_error';

interface CommandResult {
  command: string;
  outcome: CommandOutcome;
  exit_code: number | null;
  duration_ms: number;
  stderr_snippet: string;
}

interface VerificationResult {
  task_id: string;
  task_hash: string;
  status: 'verified' | 'rejected';
  reason: RejectionReason | null;
  fixture_fail_to_pass: CommandResult[];
  fix_fail_to_pass: CommandResult[];
  fixture_pass_to_pass: CommandResult[];
  fix_pass_to_pass: CommandResult[];
  verified_at: string;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { limit: number; family: string | null; force: boolean } {
  const args = process.argv.slice(2);
  let limit = Infinity;
  let family: string | null = null;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--family' && args[i + 1]) {
      family = args[i + 1];
      i++;
    } else if (args[i] === '--force') {
      force = true;
    }
  }

  return { limit, family, force };
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function hashTaskRecord(task: TaskRecord): string {
  // Hash the fields that affect verification outcome
  const payload = JSON.stringify({
    fixture_ref: task.fixture_ref,
    gold_fix_ref: task.gold_fix_ref,
    fail_to_pass: task.fail_to_pass,
    pass_to_pass: task.pass_to_pass,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Worktree management
// ---------------------------------------------------------------------------

const WORKTREE_BASE = join(REPO_ROOT, '.tasksmith-worktrees');

async function createWorktree(ref: string, name: string): Promise<string> {
  const worktreePath = join(WORKTREE_BASE, name);

  // Clean up if leftover from a previous run
  try {
    await exec(`git worktree remove --force ${worktreePath}`, {
      ...EXEC_OPTS,
      cwd: REPO_ROOT,
    });
  } catch {
    // Doesn't exist, fine
  }

  await mkdir(WORKTREE_BASE, { recursive: true });
  await exec(`git worktree add --detach ${worktreePath} ${ref}`, {
    ...EXEC_OPTS,
    cwd: REPO_ROOT,
  });

  return worktreePath;
}

async function removeWorktree(worktreePath: string): Promise<void> {
  try {
    await exec(`git worktree remove --force ${worktreePath}`, {
      ...EXEC_OPTS,
      cwd: REPO_ROOT,
    });
  } catch {
    // Best effort — log but don't fail
    console.error(
      `[verify] WARNING: failed to remove worktree ${worktreePath}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

const CMD_TIMEOUT_MS = 120_000; // 2 minutes per command

async function runCommand(
  command: string,
  cwd: string,
): Promise<CommandResult> {
  const start = Date.now();

  try {
    const { stderr } = await exec(command, {
      ...EXEC_OPTS,
      cwd,
      timeout: CMD_TIMEOUT_MS,
    });
    return {
      command,
      outcome: 'pass',
      exit_code: 0,
      duration_ms: Date.now() - start,
      stderr_snippet: stderr.slice(-500),
    };
  } catch (err: unknown) {
    const duration_ms = Date.now() - start;
    const error = err as {
      code?: string | number;
      killed?: boolean;
      stderr?: string;
      message?: string;
    };
    const stderr = (error.stderr || error.message || '').slice(-500);

    // Timeout
    if (error.killed || error.code === 'ETIMEDOUT') {
      return {
        command,
        outcome: 'timeout',
        exit_code: null,
        duration_ms,
        stderr_snippet: stderr,
      };
    }

    // Missing tool — check BEFORE missing_path to avoid ENOENT misclassification
    if (
      stderr.includes('command not found') ||
      (stderr.includes('ENOENT') && stderr.includes('spawn'))
    ) {
      return {
        command,
        outcome: 'missing_tool',
        exit_code: null,
        duration_ms,
        stderr_snippet: stderr,
      };
    }

    // Missing path / file not found
    if (
      stderr.includes('no such file or directory') ||
      stderr.includes('No such file or directory') ||
      (stderr.includes('ENOENT') && !stderr.includes('spawn')) ||
      // rg returns exit code 1 for no matches, 2 for errors
      (command.startsWith('rg ') && error.code === 2)
    ) {
      return {
        command,
        outcome: 'missing_path',
        exit_code: typeof error.code === 'number' ? error.code : null,
        duration_ms,
        stderr_snippet: stderr,
      };
    }

    // Normal failure (non-zero exit)
    if (typeof error.code === 'number') {
      return {
        command,
        outcome: 'fail',
        exit_code: error.code,
        duration_ms,
        stderr_snippet: stderr,
      };
    }

    // rg exit code 1 = no matches = fail (expected on fixture)
    if (command.startsWith('rg ')) {
      return {
        command,
        outcome: 'fail',
        exit_code: 1,
        duration_ms,
        stderr_snippet: stderr,
      };
    }

    // Unknown error
    return {
      command,
      outcome: 'infra_error',
      exit_code: null,
      duration_ms,
      stderr_snippet: stderr,
    };
  }
}

// ---------------------------------------------------------------------------
// Setup — install deps in worktree
// ---------------------------------------------------------------------------

async function setupWorktree(worktreePath: string): Promise<boolean> {
  try {
    // Check if pnpm-lock.yaml exists — if not, very old ref
    await readFile(join(worktreePath, 'pnpm-lock.yaml'));
  } catch {
    console.error(`[verify]     No pnpm-lock.yaml at ref — skipping install`);
    return true; // proceed without install, commands might still work (rg)
  }

  try {
    await exec('pnpm install --frozen-lockfile', {
      ...EXEC_OPTS,
      cwd: worktreePath,
      timeout: 180_000, // 3 minutes for install
    });
    return true;
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    console.error(
      `[verify]     pnpm install failed: ${(error.stderr || error.message || '').slice(-200)}`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Verification logic
// ---------------------------------------------------------------------------

function needsInstall(commands: string[]): boolean {
  return commands.some(
    (c) => c.includes('pnpm') || c.includes('vitest') || c.includes('tsc'),
  );
}

async function verifyTask(task: TaskRecord): Promise<VerificationResult> {
  const taskHash = hashTaskRecord(task);
  const startTime = Date.now();

  const result: VerificationResult = {
    task_id: task.task_id,
    task_hash: taskHash,
    status: 'rejected',
    reason: null,
    fixture_fail_to_pass: [],
    fix_fail_to_pass: [],
    fixture_pass_to_pass: [],
    fix_pass_to_pass: [],
    verified_at: new Date().toISOString(),
    duration_ms: 0,
  };

  const fixtureWorktree = `fixture-${task.task_id.slice(0, 40)}`;
  const fixWorktree = `fix-${task.task_id.slice(0, 40)}`;
  let fixturePath: string | null = null;
  let fixPath: string | null = null;

  try {
    // --- Step 1: Create fixture worktree ---
    console.error(
      `[verify]   Creating fixture worktree at ${task.fixture_ref.slice(0, 8)}...`,
    );
    fixturePath = await createWorktree(task.fixture_ref, fixtureWorktree);

    // Setup if needed
    const allCommands = [...task.fail_to_pass, ...task.pass_to_pass];
    if (needsInstall(allCommands)) {
      console.error(`[verify]   Installing deps in fixture...`);
      const ok = await setupWorktree(fixturePath);
      if (!ok) {
        result.reason = 'setup_failed';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
    }

    // --- Step 2: Run fail_to_pass on fixture — expect majority to fail ---
    console.error(
      `[verify]   Running fail_to_pass on fixture (${task.fail_to_pass.length} commands)...`,
    );
    let failCount = 0;
    for (const cmd of task.fail_to_pass) {
      const cmdResult = await runCommand(cmd, fixturePath);
      result.fixture_fail_to_pass.push(cmdResult);

      if (
        cmdResult.outcome === 'missing_path' ||
        cmdResult.outcome === 'missing_tool'
      ) {
        result.reason = 'command_missing';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
      if (cmdResult.outcome === 'timeout') {
        result.reason = 'timeout';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
      if (cmdResult.outcome === 'infra_error') {
        result.reason = 'setup_failed';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
      if (cmdResult.outcome === 'fail') {
        failCount++;
      }
    }

    // Require a majority of fail_to_pass commands to actually fail.
    // A task where 1 out of 9 probes fails is mostly saturated — not useful.
    const failRatio = failCount / task.fail_to_pass.length;
    if (failCount === 0) {
      result.reason = 'fixture_already_green';
      result.duration_ms = Date.now() - startTime;
      return result;
    }
    if (failRatio < 0.5) {
      console.error(
        `[verify]   Only ${failCount}/${task.fail_to_pass.length} fail_to_pass commands failed (${(failRatio * 100).toFixed(0)}%) — too saturated`,
      );
      result.reason = 'fail_to_pass_saturated';
      result.duration_ms = Date.now() - startTime;
      return result;
    }

    // --- Step 3: Run pass_to_pass on fixture — expect all pass ---
    console.error(
      `[verify]   Running pass_to_pass on fixture (${task.pass_to_pass.length} commands)...`,
    );
    for (const cmd of task.pass_to_pass) {
      const cmdResult = await runCommand(cmd, fixturePath);
      result.fixture_pass_to_pass.push(cmdResult);

      if (
        cmdResult.outcome === 'missing_path' ||
        cmdResult.outcome === 'missing_tool'
      ) {
        result.reason = 'command_missing';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
      if (cmdResult.outcome === 'timeout') {
        result.reason = 'timeout';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
      if (cmdResult.outcome !== 'pass') {
        result.reason = 'pass_to_pass_unstable_fixture';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
    }

    // --- Step 4: Create fix worktree ---
    console.error(
      `[verify]   Creating fix worktree at ${task.gold_fix_ref.slice(0, 8)}...`,
    );
    fixPath = await createWorktree(task.gold_fix_ref, fixWorktree);

    if (needsInstall(allCommands)) {
      console.error(`[verify]   Installing deps in fix...`);
      const ok = await setupWorktree(fixPath);
      if (!ok) {
        result.reason = 'setup_failed';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
    }

    // --- Step 5: Run fail_to_pass on fix — expect all pass ---
    console.error(
      `[verify]   Running fail_to_pass on fix (${task.fail_to_pass.length} commands)...`,
    );
    for (const cmd of task.fail_to_pass) {
      const cmdResult = await runCommand(cmd, fixPath);
      result.fix_fail_to_pass.push(cmdResult);

      if (
        cmdResult.outcome === 'missing_path' ||
        cmdResult.outcome === 'missing_tool'
      ) {
        result.reason = 'command_missing';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
      if (cmdResult.outcome === 'timeout') {
        result.reason = 'timeout';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
      if (cmdResult.outcome !== 'pass') {
        result.reason = 'fix_not_green';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
    }

    // --- Step 6: Run pass_to_pass on fix — expect all pass ---
    console.error(
      `[verify]   Running pass_to_pass on fix (${task.pass_to_pass.length} commands)...`,
    );
    for (const cmd of task.pass_to_pass) {
      const cmdResult = await runCommand(cmd, fixPath);
      result.fix_pass_to_pass.push(cmdResult);

      if (
        cmdResult.outcome === 'missing_path' ||
        cmdResult.outcome === 'missing_tool'
      ) {
        result.reason = 'command_missing';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
      if (cmdResult.outcome === 'timeout') {
        result.reason = 'timeout';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
      if (cmdResult.outcome !== 'pass') {
        result.reason = 'pass_to_pass_unstable_fix';
        result.duration_ms = Date.now() - startTime;
        return result;
      }
    }

    // --- All checks passed ---
    result.status = 'verified';
    result.reason = null;
    result.duration_ms = Date.now() - startTime;
    return result;
  } finally {
    // ALWAYS clean up worktrees
    if (fixturePath) await removeWorktree(fixturePath);
    if (fixPath) await removeWorktree(fixPath);
  }
}

// ---------------------------------------------------------------------------
// Resumability
// ---------------------------------------------------------------------------

async function loadExistingResults(): Promise<Map<string, VerificationResult>> {
  const results = new Map<string, VerificationResult>();

  for (const dir of ['verified', 'rejected']) {
    const dirPath = join(REPO_ROOT, 'tasksmith', dir);
    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await readFile(join(dirPath, file), 'utf8');
        const result: VerificationResult = JSON.parse(content);
        results.set(result.task_id, result);
      } catch {
        // Corrupted file, ignore
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface VerifyReport {
  generated_at: string;
  total_tasks: number;
  verified: number;
  rejected: number;
  skipped_cached: number;
  rejection_reasons: Record<string, number>;
  family_histogram: Record<string, { verified: number; rejected: number }>;
  top_30_verified: string[];
  total_duration_ms: number;
}

function generateReport(
  allResults: VerificationResult[],
  tasks: TaskRecord[],
  skippedCached: number,
): VerifyReport {
  const taskMap = new Map(tasks.map((t) => [t.task_id, t]));

  const verified = allResults.filter((r) => r.status === 'verified');
  const rejected = allResults.filter((r) => r.status === 'rejected');

  const rejectionReasons: Record<string, number> = {};
  for (const r of rejected) {
    const reason = r.reason || 'unknown';
    rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
  }

  const familyHistogram: Record<
    string,
    { verified: number; rejected: number }
  > = {};
  for (const r of allResults) {
    const task = taskMap.get(r.task_id);
    const family = task?.family || 'unknown';
    if (!familyHistogram[family]) {
      familyHistogram[family] = { verified: 0, rejected: 0 };
    }
    familyHistogram[family][r.status]++;
  }

  // Top 30: prefer diary-linked, then by family diversity
  const verifiedTasks = verified
    .map((r) => taskMap.get(r.task_id))
    .filter((t): t is TaskRecord => !!t);

  // Sort: diary-linked first, then by confidence
  verifiedTasks.sort((a, b) => {
    if (a.diary_entry_ids.length > 0 && b.diary_entry_ids.length === 0)
      return -1;
    if (a.diary_entry_ids.length === 0 && b.diary_entry_ids.length > 0)
      return 1;
    const confOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2);
  });

  const top30 = verifiedTasks.slice(0, 30).map((t) => t.task_id);

  return {
    generated_at: new Date().toISOString(),
    total_tasks: allResults.length,
    verified: verified.length,
    rejected: rejected.length,
    skipped_cached: skippedCached,
    rejection_reasons: rejectionReasons,
    family_histogram: familyHistogram,
    top_30_verified: top30,
    total_duration_ms: allResults.reduce((sum, r) => sum + r.duration_ms, 0),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { limit, family, force } = parseArgs();

  const tasksDir = join(REPO_ROOT, 'tasksmith/candidates/tasks');
  const verifiedDir = join(REPO_ROOT, 'tasksmith/verified');
  const rejectedDir = join(REPO_ROOT, 'tasksmith/rejected');
  const reportFile = join(REPO_ROOT, 'tasksmith/verify-report.json');

  await mkdir(verifiedDir, { recursive: true });
  await mkdir(rejectedDir, { recursive: true });

  // Load task records
  const taskFiles = (await readdir(tasksDir)).filter(
    (f) => f.endsWith('.json') && f !== 'index.jsonl',
  );

  let tasks: TaskRecord[] = [];
  for (const file of taskFiles) {
    const content = await readFile(join(tasksDir, file), 'utf8');
    tasks.push(JSON.parse(content));
  }

  // Filter by family if specified
  if (family) {
    tasks = tasks.filter((t) => t.family === family);
  }

  // Apply limit
  if (limit < tasks.length) {
    tasks = tasks.slice(0, limit);
  }

  console.error(
    `[verify] Loaded ${tasks.length} tasks${family ? ` (family: ${family})` : ''}`,
  );

  // Load existing results for resumability
  const existingResults = force
    ? new Map<string, VerificationResult>()
    : await loadExistingResults();

  const allResults: VerificationResult[] = [];
  let skippedCached = 0;
  let verifiedCount = 0;
  let rejectedCount = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const taskHash = hashTaskRecord(task);

    // Check cache
    const existing = existingResults.get(task.task_id);
    if (existing && existing.task_hash === taskHash) {
      console.error(
        `[verify] [${i + 1}/${tasks.length}] CACHED ${task.task_id} → ${existing.status}`,
      );
      allResults.push(existing);
      if (existing.status === 'verified') verifiedCount++;
      else rejectedCount++;
      skippedCached++;
      continue;
    }

    console.error(
      `[verify] [${i + 1}/${tasks.length}] Verifying ${task.task_id} (${task.family})...`,
    );

    const result = await verifyTask(task);
    allResults.push(result);

    // Write result to appropriate directory
    const outDir = result.status === 'verified' ? verifiedDir : rejectedDir;
    // Remove from the other directory if it existed there before
    const otherDir = result.status === 'verified' ? rejectedDir : verifiedDir;
    const outFile = join(outDir, `${task.task_id}.json`);
    const otherFile = join(otherDir, `${task.task_id}.json`);

    await writeFile(outFile, JSON.stringify(result, null, 2) + '\n');
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(otherFile);
    } catch {
      // Didn't exist in the other dir
    }

    if (result.status === 'verified') {
      verifiedCount++;
      console.error(`[verify]   ✓ VERIFIED (${result.duration_ms}ms)`);
    } else {
      rejectedCount++;
      console.error(
        `[verify]   ✗ REJECTED: ${result.reason} (${result.duration_ms}ms)`,
      );
    }
  }

  // Generate report
  const report = generateReport(allResults, tasks, skippedCached);
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');

  console.error(`\n[verify] ═══════════════════════════════════════`);
  console.error(
    `[verify] Results: ${verifiedCount} verified, ${rejectedCount} rejected, ${skippedCached} cached`,
  );

  if (Object.keys(report.rejection_reasons).length > 0) {
    console.error(`[verify] Rejection reasons:`);
    for (const [reason, count] of Object.entries(report.rejection_reasons).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.error(`[verify]   ${reason}: ${count}`);
    }
  }

  console.error(`[verify] Family results:`);
  for (const [fam, counts] of Object.entries(report.family_histogram).sort(
    (a, b) => b[1].verified - a[1].verified,
  )) {
    console.error(
      `[verify]   ${fam}: ${counts.verified} verified, ${counts.rejected} rejected`,
    );
  }

  console.error(
    `[verify] Total duration: ${(report.total_duration_ms / 1000).toFixed(1)}s`,
  );
  console.error(`[verify] Report written to tasksmith/verify-report.json`);

  // Final worktree cleanup — belt and suspenders
  try {
    await exec('git worktree prune', { ...EXEC_OPTS, cwd: REPO_ROOT });
  } catch {
    // Non-critical
  }
}

main().catch((err) => {
  // Emergency worktree cleanup
  exec('git worktree prune', { ...EXEC_OPTS, cwd: REPO_ROOT }).catch(() => {});
  console.error('[verify] Fatal:', err);
  process.exit(1);
});
