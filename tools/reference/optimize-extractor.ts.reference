#!/usr/bin/env -S npx tsx
// optimize-extractor.ts — Phase 4: GEPA self-optimization of extraction instruction
/* eslint-disable no-console */

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { AxGEPAAdapter } from '@ax-llm/ax';
import { runGepaOptimization } from '@moltnet/context-evals/gepa';
import {
  buildAI,
  resolveRepoRoot,
  str,
} from '@moltnet/context-evals/pipeline-shared';

import { discoverCandidates, loadHarvestState } from './pr-discovery.js';
import { extractTask, SEED_INSTRUCTION } from './task-extractor.js';
import type { PrCandidate } from './types.js';
import { verifyTask } from './verify.js';

// ── CLI ──

const { values } = parseArgs({
  options: {
    'student-provider': { type: 'string', default: 'claude-agent-sdk' },
    'student-model': { type: 'string' },
    'teacher-provider': { type: 'string', default: 'claude-agent-sdk' },
    'teacher-model': { type: 'string', default: 'claude-sonnet-4-6' },
    'num-trials': { type: 'string', default: '10' },
    'max-metric-calls': { type: 'string', default: '200' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
Usage: pnpm --filter @moltnet/tools tasksmith:optimize [options]

Optimizes the extraction instruction using GEPA.
Uses verified tasksmith tasks as the training set.

Options:
  --student-provider <name>  AI for extraction (default: claude-agent-sdk)
  --student-model <model>    Model for extraction
  --teacher-provider <name>  AI for reflection (default: claude-agent-sdk)
  --teacher-model <model>    Model for reflection (default: claude-sonnet-4-6)
  --num-trials <n>           GEPA trials (default: 10)
  --max-metric-calls <n>     Max metric evaluations (default: 200)
  -h, --help                 Show this help
`);
  process.exit(0);
}

// ── Main ──

const repoRoot = await resolveRepoRoot();
const stateFile = resolve(repoRoot, 'tasksmith', 'state.json');
await loadHarvestState(stateFile);

const studentAI = buildAI({
  provider: str(values['student-provider']) as Parameters<
    typeof buildAI
  >[0]['provider'],
  model: values['student-model'] ? str(values['student-model']) : undefined,
});

const teacherAI = buildAI({
  provider: str(values['teacher-provider']) as Parameters<
    typeof buildAI
  >[0]['provider'],
  model: values['teacher-model'] ? str(values['teacher-model']) : undefined,
});

// Use processed PRs as training data
// Re-discover to get PrCandidate objects for verified tasks only.
const verifiedDir = resolve(repoRoot, 'tasksmith', 'verified');
const verifiedFiles = await readdir(verifiedDir).catch(() => [] as string[]);
const verifiedPrs = Array.from(
  new Set(
    verifiedFiles
      .filter((file) => file.endsWith('.json'))
      .map((file) => parseInt(file.replace('.json', ''), 10))
      .filter((pr) => Number.isFinite(pr)),
  ),
).sort((a, b) => b - a);

if (verifiedPrs.length < 2) {
  console.error(
    `[optimize] Only ${verifiedPrs.length} verified tasks found. Run tasksmith:harvest until you have at least 2 verified tasks in tasksmith/verified/.`,
  );
  process.exit(1);
}

const { candidates } = await discoverCandidates(repoRoot, {
  prs: verifiedPrs.slice(0, 50),
  force: true,
});

type TaskWithId = PrCandidate & { id: string };
const tasks: TaskWithId[] = candidates.map((c) => ({
  ...c,
  id: `pr-${c.number}`,
}));

console.log(`[optimize] Using ${tasks.length} PRs for GEPA optimization`);

const numTrials = parseInt(str(values['num-trials']) || '10', 10);
const maxMetricCalls = parseInt(str(values['max-metric-calls']) || '200', 10);

const t0 = performance.now();

const result = await runGepaOptimization({
  tasks,
  // Note: only `evaluate` is implemented. GEPA also calls `make_reflective_dataset`
  // and `propose_new_texts` on the adapter for guided reflection, but wraps those in
  // try/catch and falls back to generic reflectInstruction when they're missing.
  // TODO: implement full AxGEPAAdapter for better reflection quality.
  adapter: {
    evaluate: async (
      batch: TaskWithId[],
      candidate: { instruction: string },
    ) => {
      const scores: number[] = [];
      for (const task of batch) {
        const extractionResult = await extractTask(
          task as PrCandidate,
          studentAI,
          repoRoot,
          candidate.instruction,
        );
        if ('skipReason' in extractionResult) {
          scores.push(0);
        } else {
          const verification = await verifyTask(
            extractionResult.task,
            (task as PrCandidate).number,
            { debug: false, skipDocker: true },
          );
          scores.push(
            verification.status === 'verified'
              ? 1
              : verification.status === 'unit_verified'
                ? 0.5
                : 0,
          );
        }
      }
      return { scores, trajectories: null };
    },
  } as unknown as AxGEPAAdapter<TaskWithId, unknown, unknown>,
  seedInstruction: SEED_INSTRUCTION,
  studentAI,
  teacherAI,
  numTrials,
  maxMetricCalls,
  verbose: true,
  buildExamples: (tasks) => tasks.map((t) => ({ id: t.id, task_id: t.id })),
  evaluateOne: async (task, instruction) => {
    const extractionResult = await extractTask(
      task,
      studentAI,
      repoRoot,
      instruction,
    );
    if ('skipReason' in extractionResult) return { score: 0 };
    const verification = await verifyTask(extractionResult.task, task.number, {
      debug: false,
      skipDocker: true,
    });
    return {
      score:
        verification.status === 'verified'
          ? 1
          : verification.status === 'unit_verified'
            ? 0.5
            : 0,
    };
  },
});

// Save optimized instruction + Pareto front
const instructionsDir = resolve(repoRoot, 'tasksmith', 'instructions');
await mkdir(instructionsDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(
  resolve(instructionsDir, `${timestamp}.txt`),
  result.bestInstruction,
);
await writeFile(
  resolve(instructionsDir, `${timestamp}-pareto.json`),
  JSON.stringify(
    {
      bestScore: result.bestScore,
      paretoFront: result.paretoFront.map((p) => ({
        scores: p.scores,
        dominatedSolutions: p.dominatedSolutions,
        instructionLength: p.instruction.length,
        instructionPreview: p.instruction.slice(0, 200),
      })),
    },
    null,
    2,
  ),
);

// Save each Pareto candidate instruction as a separate file
for (let i = 0; i < result.paretoFront.length; i++) {
  await writeFile(
    resolve(instructionsDir, `${timestamp}-pareto-${i}.txt`),
    result.paretoFront[i].instruction,
  );
}

const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log('\n═══════════════════════════════════════════════');
console.log('  OPTIMIZATION RESULTS');
console.log('═══════════════════════════════════════════════');
console.log(`  Best score:    ${result.bestScore.toFixed(3)}`);
console.log(`  Instruction:   ${result.bestInstruction.length} chars`);
console.log(`  Pareto front:  ${result.paretoFront.length} candidates`);
for (const [i, p] of result.paretoFront.entries()) {
  const scoreStr = Object.entries(p.scores)
    .map(([k, v]) => `${k}=${(v as number).toFixed(3)}`)
    .join(', ');
  console.log(`    [${i}] ${scoreStr} (${p.instruction.length} chars)`);
}
console.log(`  Saved to:      tasksmith/instructions/${timestamp}*.txt`);
console.log(`  Time:          ${elapsed}s`);
console.log('═══════════════════════════════════════════════');
