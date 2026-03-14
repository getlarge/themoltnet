#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */
/**
 * skill-eval — GEPA-driven skill optimization for LeGreffier
 *
 * Usage:
 *   pnpm gpack:skill-eval --eval commit-single-fix --baseline
 *   pnpm gpack:skill-eval --eval all --ai-key <key>
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { ax, AxGEPA } from '@ax-llm/ax';
import {
  type SkillEvalTask,
  SkillEvalTaskSchema,
} from '@moltnet/context-evals';
import { loadContextEvalsConfig } from '@moltnet/context-evals/config';
import {
  buildAI,
  buildAverage,
  buildCacheKey,
  loadEnvLocal,
  resolveAIKey,
  resolveRepoRoot,
  str,
} from '@moltnet/context-evals/pipeline-shared';
import { SkillEvalAdapter } from '@moltnet/context-evals/skill-adapter';
import { Value } from '@sinclair/typebox/value';

import { createScorer, loadEvalEnv } from './index.js';

// ── Args ──────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  allowPositionals: true,
  options: {
    eval: { type: 'string' },
    'skill-file': { type: 'string' },
    'agent-config-dir': { type: 'string' },
    'agent-name': { type: 'string' },
    'mcp-url': { type: 'string' },
    'mcp-client-id': { type: 'string' },
    'mcp-client-secret': { type: 'string' },
    'ai-key': { type: 'string' },
    model: { type: 'string' },
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

const studentModel = str(values['model']);
const teacherModel = str(values['teacher-model']);
const aiKey = resolveAIKey(str(values['ai-key']), studentModel);
const claudeModel =
  str(values['claude-model']) ||
  envConfig.GPACK_AGENT_MODEL ||
  'claude-sonnet-4-6';
const maxMetricCalls = parseInt(str(values['max-evals']) || '30', 10);
const numTrials = parseInt(str(values['num-trials']) || '8', 10);
const runBaseline = values['baseline'] === true;
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

  const scorer = createScorer(
    evalEnv.apiUrl,
    evalEnv.diaryId,
    evalEnv.clientId,
    evalEnv.clientSecret,
  );

  // Load the full skill — this is the candidate GEPA optimizes
  const skillFile =
    str(values['skill-file']) || '.claude/skills/legreffier/SKILL.md';
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

  if (runBaseline) {
    console.log('[skill-eval] running baseline...');
    const result = await adapter.evaluate(
      tasks,
      { instruction: skillContent },
      true,
    );
    const avgScore = buildAverage(result.scores);
    console.log(
      `[skill-eval] baseline scores: ${result.scores.map((s) => s.toFixed(2)).join(', ')} avg=${avgScore.toFixed(3)}`,
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
          scores: result.scores,
          avg: avgScore,
          traces: result.trajectories,
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
  // TODO: investigate GEPA optimize_anything (task #13):
  //   - objective_scores (multi-objective) instead of single scalar metric
  //   - propose_new_texts method for direct instruction rewriting
  if (!aiKey) {
    throw new Error(
      '[skill-eval] GEPA optimization requires an AI key. Pass --ai-key or set OPENAI_API_KEY/ANTHROPIC_API_KEY/GOOGLE_API_KEY.',
    );
  }

  const studentAI = buildAI({ aiKey, model: studentModel });
  const teacherAI = teacherModel
    ? buildAI({ aiKey, model: teacherModel })
    : undefined;

  const passthrough = ax('taskPrompt:string -> skillSection:string');
  passthrough.setInstruction(skillContent);

  const trainingTasks =
    tasks.length >= 2
      ? tasks
      : [{ ...tasks[0] }, { ...tasks[0], id: `${tasks[0].id}-replica` }];

  const optimizer = new AxGEPA({
    studentAI,
    ...(teacherAI ? { teacherAI } : {}),
    numTrials,
    verbose,
    seed: 42,
  });

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  // GEPA calls adapter.evaluate() directly with these examples, so they
  // need the full SkillEvalTask shape (baseCommit, patchFiles, etc.).
  // Fields with `unknown`/optional types are cast to `object | null` to
  // satisfy AxFieldValue.
  const trainingExamples = trainingTasks.map((task) => ({
    id: task.id,
    taskPrompt: task.taskPrompt,
    baseCommit: task.baseCommit,
    skillPath: task.skillPath,
    patchFiles: task.patchFiles,
    expected: (task.expected ?? null) as object | null,
    env: (task.env ?? null) as object | null,
  }));

  console.log(
    `[skill-eval] starting GEPA optimization (numTrials=${numTrials} maxMetricCalls=${maxMetricCalls})...`,
  );

  const metricCache = new Map<string, number>();
  const getCurrentInstruction = (): string =>
    (passthrough as { instruction?: string }).instruction ?? skillContent;

  const result = await optimizer.compile(
    passthrough,
    trainingExamples,
    async ({ example }) => {
      const taskId =
        typeof example['id'] === 'string'
          ? example['id'].replace(/-replica$/, '')
          : '';
      const task = taskById.get(taskId);
      if (!task) return 0;
      const packContent = getCurrentInstruction();
      const cacheKey = buildCacheKey(task.id, packContent);
      const cached = metricCache.get(cacheKey);
      if (cached !== undefined) return cached;

      const evalResult = await adapter.evaluate([task], {
        instruction: packContent,
      });
      const score = evalResult.scores[0] ?? 0;
      metricCache.set(cacheKey, score);
      return score;
    },
    {
      maxMetricCalls,
      gepaAdapter: adapter,
      feedbackExamples: trainingExamples,
      validationExamples: trainingExamples,
    },
  );

  const bestScore = result.bestScore;
  const bestPack = result.optimizedProgram?.instruction ?? skillContent;

  console.log(`\n[skill-eval] optimization complete`);
  console.log(`  best score: ${bestScore.toFixed(3)}`);

  const outDir = resolve(repoRoot, 'evals', 'runs');
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, `skill-eval-optimized-${Date.now()}.md`);
  await writeFile(outPath, bestPack, 'utf8');
  console.log(`[skill-eval] best skill section saved to ${outPath}`);

  // Final evaluation on canonical task set
  const finalEval = await adapter.evaluate(
    tasks,
    { instruction: bestPack },
    true,
  );
  const finalAvg = buildAverage(finalEval.scores);
  console.log(
    `[skill-eval] final scores: ${finalEval.scores.map((s) => s.toFixed(2)).join(', ')} avg=${finalAvg.toFixed(3)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
