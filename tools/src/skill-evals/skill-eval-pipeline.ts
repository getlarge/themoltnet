#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */
/**
 * skill-eval — GEPA-driven skill optimization
 *
 * Usage:
 *   pnpm gpack:skill-eval --eval commit-single-fix --baseline
 *   pnpm gpack:skill-eval --eval all --ai-key <key>
 *   pnpm gpack:skill-eval --eval all --scorer legreffier --baseline
 */

import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  type SkillEvalTask,
  SkillEvalTaskSchema,
} from '@moltnet/context-evals';
import { loadContextEvalsConfig } from '@moltnet/context-evals/config';
import { runBaseline, runGepaOptimization } from '@moltnet/context-evals/gepa';
import {
  type AIProvider,
  buildAI,
  loadEnvLocal,
  resolveAIKey,
  resolveRepoRoot,
  str,
} from '@moltnet/context-evals/pipeline-shared';
import { SkillEvalAdapter } from '@moltnet/context-evals/skill-adapter';
import { Value } from '@sinclair/typebox/value';

import { loadEvalEnv } from './eval-env.js';
import { defaultScorerName, resolveScorer } from './scorers.js';

// ── Args ──────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  allowPositionals: true,
  options: {
    eval: { type: 'string' },
    scorer: { type: 'string' },
    'skill-file': { type: 'string' },
    'agent-config-dir': { type: 'string' },
    'agent-name': { type: 'string' },
    'mcp-url': { type: 'string' },
    'mcp-client-id': { type: 'string' },
    'mcp-client-secret': { type: 'string' },
    'student-provider': { type: 'string' },
    'teacher-provider': { type: 'string' },
    'ai-key': { type: 'string' },
    'student-model': { type: 'string' },
    'teacher-model': { type: 'string' },
    'claude-model': { type: 'string', default: 'claude-sonnet-4-6' },
    'max-evals': { type: 'string', default: '30' },
    'num-trials': { type: 'string', default: '8' },
    baseline: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
  },
  strict: false,
});

const repoRoot = await resolveRepoRoot();
await loadEnvLocal(repoRoot);
const envConfig = loadContextEvalsConfig();

const evalArg = str(values['eval']);
if (!evalArg) {
  console.error(
    'Usage: pnpm gpack:skill-eval --eval <eval-name|all> [options]',
  );
  process.exit(1);
}

const studentProvider = (str(values['student-provider']) || undefined) as
  | AIProvider
  | undefined;
const teacherProvider = (str(values['teacher-provider']) || undefined) as
  | AIProvider
  | undefined;
const studentModel = str(values['student-model']);
const teacherModel = str(values['teacher-model']);
const aiKey = resolveAIKey(str(values['ai-key']), studentProvider);
const claudeModel =
  str(values['claude-model']) ||
  envConfig.GPACK_AGENT_MODEL ||
  'claude-sonnet-4-6';
const maxMetricCalls = parseInt(str(values['max-evals']) || '30', 10);
const numTrials = parseInt(str(values['num-trials']) || '8', 10);
const runBaselineMode = values['baseline'] === true;
const verbose = values['verbose'] === true;

// ── Skill eval task loading ──────────────────────────────────────────────────

async function loadSkillEvalInputs(spec: string): Promise<SkillEvalTask[]> {
  const evalsDir = resolve(repoRoot, 'evals');
  const names =
    spec === 'all'
      ? (await readdir(evalsDir, { withFileTypes: true }))
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : spec
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean);

  const tasks: SkillEvalTask[] = [];
  for (const name of names) {
    const dir = resolve(evalsDir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(`${dir}/scenario.json`, 'utf8'));
    } catch {
      continue;
    }
    if (!Value.Check(SkillEvalTaskSchema, raw)) {
      if (spec === 'all') continue;
      throw new Error(`Invalid skill eval task: ${name}`);
    }
    tasks.push(raw as SkillEvalTask);
  }
  return tasks;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const tasks = await loadSkillEvalInputs(evalArg);
  if (tasks.length === 0) {
    throw new Error(`[skill-eval] no tasks resolved from --eval "${evalArg}"`);
  }
  console.log(`[skill-eval] loaded ${tasks.length} task(s)`);

  const evalEnv = await loadEvalEnv(repoRoot);
  const scorerName = str(values['scorer']) || defaultScorerName;
  const scorer = resolveScorer(scorerName, evalEnv);

  // Load the full skill — this is the candidate GEPA optimizes
  const skillFile =
    str(values['skill-file']) || `.claude/skills/${scorerName}/SKILL.md`;
  const skillContent = await readFile(resolve(repoRoot, skillFile), 'utf8');

  // Build MCP config
  const mcpUrl = str(values['mcp-url']) || evalEnv.mcpUrl;
  const mcpClientId = str(values['mcp-client-id']) || evalEnv.clientId;
  const mcpClientSecret =
    str(values['mcp-client-secret']) || evalEnv.clientSecret;
  const agentConfigDir = str(values['agent-config-dir']) || evalEnv.configDir;
  const agentName = str(values['agent-name']) || evalEnv.agentName;

  const adapter = new SkillEvalAdapter({
    repoRoot,
    mcpServers: {
      [agentName]: {
        type: 'http',
        url: mcpUrl,
        headers: {
          'X-Client-Id': mcpClientId,
          'X-Client-Secret': mcpClientSecret,
        },
      },
    },
    agentConfigDir,
    agentName,
    agentEnv: {
      MOLTNET_AGENT_NAME: agentName,
      MOLTNET_DIARY_ID: evalEnv.diaryId,
      MOLTNET_FINGERPRINT: evalEnv.fingerprint,
    },
    scorer,
    claudeModel,
    verbose,
  });

  if (runBaselineMode) {
    console.log('[skill-eval] running baseline...');
    const baselineResult = await runBaseline(adapter, tasks, skillContent);
    console.log(
      `[skill-eval] baseline scores: ${baselineResult.scores.map((s) => s.toFixed(2)).join(', ')} avg=${baselineResult.averageScore.toFixed(3)}`,
    );
    const outDir = resolve(repoRoot, 'evals', 'runs');
    await mkdir(outDir, { recursive: true });
    const outPath = resolve(outDir, `skill-eval-baseline-${Date.now()}.json`);
    await writeFile(
      outPath,
      JSON.stringify(
        {
          mode: 'baseline',
          timestamp: new Date().toISOString(),
          scores: baselineResult.scores,
          avg: baselineResult.averageScore,
          traces: baselineResult.trajectories,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`[skill-eval] traces saved to ${outPath}`);
    return;
  }

  // GEPA optimization
  if (!studentProvider) {
    throw new Error(
      '[skill-eval] GEPA optimization requires --student-provider (openai, anthropic, google-gemini, or claude-agent-sdk).',
    );
  }
  const studentAI = buildAI({
    provider: studentProvider,
    aiKey,
    model: studentModel,
  });
  if (teacherModel && !teacherProvider) {
    throw new Error(
      '[skill-eval] --teacher-model requires --teacher-provider.',
    );
  }
  const teacherAI =
    teacherModel && teacherProvider
      ? buildAI({ provider: teacherProvider, aiKey, model: teacherModel })
      : undefined;

  const outDir = resolve(repoRoot, 'evals', 'runs');
  await mkdir(outDir, { recursive: true });
  const tracesPath = resolve(outDir, `skill-eval-traces-${Date.now()}.jsonl`);

  console.log(
    `[skill-eval] starting GEPA optimization (numTrials=${numTrials} maxMetricCalls=${maxMetricCalls})...`,
  );
  console.log(`[skill-eval] traces streaming to ${tracesPath}`);

  const { bestScore, bestInstruction } = await runGepaOptimization({
    tasks,
    adapter,
    seedInstruction: skillContent,
    studentAI,
    teacherAI,
    numTrials,
    maxMetricCalls,
    verbose,
    buildExamples: (trainingTasks) =>
      trainingTasks.map((task) => ({
        id: task.id,
        taskPrompt: task.taskPrompt,
        baseCommit: task.baseCommit,
        skillPath: task.skillPath,
        patchFiles: task.patchFiles,
        expected: (task.expected ?? null) as object | null,
        env: (task.env ?? null) as object | null,
      })),
    evaluateOne: async (task, instruction) => {
      const evalResult = await adapter.evaluate([task], { instruction }, true);
      const score = evalResult.scores[0] ?? 0;
      const trace = evalResult.trajectories?.[0] ?? undefined;
      return { score, trace };
    },
    onEvalComplete: async (entry) => {
      await appendFile(tracesPath, JSON.stringify(entry) + '\n', 'utf8');
    },
  });

  console.log(`\n[skill-eval] optimization complete`);
  console.log(`  best score: ${bestScore.toFixed(3)}`);

  const outPath = resolve(outDir, `skill-eval-optimized-${Date.now()}.md`);
  await writeFile(outPath, bestInstruction, 'utf8');
  console.log(`[skill-eval] best skill section saved to ${outPath}`);

  const finalEval = await runBaseline(adapter, tasks, bestInstruction);
  await writeFile(
    resolve(outDir, `skill-eval-final-${Date.now()}.json`),
    JSON.stringify(
      {
        mode: 'final',
        timestamp: new Date().toISOString(),
        scores: finalEval.scores,
        avg: finalEval.averageScore,
        traces: finalEval.trajectories,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(
    `[skill-eval] final scores: ${finalEval.scores.map((s) => s.toFixed(2)).join(', ')} avg=${finalEval.averageScore.toFixed(3)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
