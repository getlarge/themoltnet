#!/usr/bin/env -S npx tsx
// optimize-extractor.ts — Phase 4: GEPA self-optimization of extraction instruction
/* eslint-disable no-console */

import { mkdir, writeFile } from 'node:fs/promises';
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
    'num-trials': { type: 'string', default: '5' },
    'max-metric-calls': { type: 'string', default: '30' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
Usage: pnpm --filter @moltnet/tools tasksmith:optimize [options]

Optimizes the extraction instruction using GEPA.
Requires 10+ PRs already processed (use tasksmith:harvest first).

Options:
  --student-provider <name>  AI for extraction (default: codex-agent-sdk)
  --student-model <model>    Model for extraction
  --teacher-provider <name>  AI for reflection (default: claude-agent-sdk)
  --teacher-model <model>    Model for reflection (default: claude-sonnet-4-6)
  --num-trials <n>           GEPA trials (default: 5)
  --max-metric-calls <n>     Max metric evaluations (default: 30)
  -h, --help                 Show this help
`);
  process.exit(0);
}

// ── Main ──

const repoRoot = await resolveRepoRoot();
const stateFile = resolve(repoRoot, 'tasksmith', 'state.json');
const state = await loadHarvestState(stateFile);

if (state.processed_prs.length < 10) {
  console.error(
    `[optimize] Only ${state.processed_prs.length} PRs processed. Run tasksmith:harvest first (need 10+).`,
  );
  process.exit(1);
}

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
// Re-discover to get PrCandidate objects for known PRs
const { candidates } = await discoverCandidates(repoRoot, {
  prs: state.processed_prs.slice(0, 50),
  force: true,
});

type TaskWithId = PrCandidate & { id: string };
const tasks: TaskWithId[] = candidates.map((c) => ({
  ...c,
  id: `pr-${c.number}`,
}));

console.log(`[optimize] Using ${tasks.length} PRs for GEPA optimization`);

const numTrials = parseInt(str(values['num-trials']) || '5', 10);
const maxMetricCalls = parseInt(str(values['max-metric-calls']) || '30', 10);

const t0 = performance.now();

const result = await runGepaOptimization({
  tasks,
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
          scores.push(verification.status === 'verified' ? 1 : 0);
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
  buildExamples: (ts: TaskWithId[]) =>
    ts.map((t) => ({ id: t.id, task_id: t.id })),
  evaluateOne: async (task: TaskWithId, instruction: string) => {
    const extractionResult = await extractTask(
      task as PrCandidate,
      studentAI,
      repoRoot,
      instruction,
    );
    if ('skipReason' in extractionResult) return { score: 0 };
    const verification = await verifyTask(
      extractionResult.task,
      (task as PrCandidate).number,
      { debug: false, skipDocker: true },
    );
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

// Save optimized instruction
const instructionsDir = resolve(repoRoot, 'tasksmith', 'instructions');
await mkdir(instructionsDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(
  resolve(instructionsDir, `${timestamp}.txt`),
  result.bestInstruction,
);

const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log('\n═══════════════════════════════════════════════');
console.log('  OPTIMIZATION RESULTS');
console.log('═══════════════════════════════════════════════');
console.log(`  Best score:    ${result.bestScore.toFixed(3)}`);
console.log(`  Instruction:   ${result.bestInstruction.length} chars`);
console.log(`  Saved to:      tasksmith/instructions/${timestamp}.txt`);
console.log(`  Time:          ${elapsed}s`);
console.log('═══════════════════════════════════════════════');
