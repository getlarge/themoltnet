#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */
/**
 * gpack — GEPA-driven context pack optimization
 *
 * Analogous to gskill (https://github.com/itsmostafa/gskill) but optimizes
 * MoltNet context packs (session-pack.md) instead of static skill files.
 * Optimized packs are stored as content-signed diary entries for CID traceability.
 *
 * Usage:
 *   pnpm gpack --eval add-dbos-dedup-queues --diary-id <uuid> --ai-key <key>
 *   pnpm gpack --eval add-dbos-dedup-queues --baseline  # run baseline (empty pack)
 *   pnpm gpack --eval all --baseline --pack-file .legreffier/context/runs/<ts>/compiled-pack.md
 *   pnpm gpack --task-id auth-permissions-export-relationshipreader-and-add-testco-2bf0c3c8 --baseline
 *   pnpm gpack --task-file tasksmith/candidates/tasks/foo.json --baseline
 *
 * Environment variables:
 *   MOLTNET_CREDENTIALS_PATH   path to moltnet.json credentials
 *   MOLTNET_DIARY_ID           diary UUID to compile context from
 *   OPENAI_API_KEY             OpenAI API key for GEPA reflection LLM
 *   ANTHROPIC_API_KEY          Anthropic API key (alternative to OpenAI)
 *   GOOGLE_API_KEY             Google AI API key (Gemini models)
 *   GPACK_AGENT_MODEL          model string (default: gpt-4o-mini)
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { compileDiary, listDiaries } from '@moltnet/api-client';
import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { MoltNetContextAdapter } from './adapter.js';
import { createAuthedClient } from './client.js';
import { loadContextEvalsConfig } from './config.js';
import type { GpackTask } from './evaluate.js';
import { runBaseline, runGepaOptimization } from './gepa.js';
import {
  type AIProvider,
  buildAI,
  loadEnvLocal,
  loadPackFile,
  resolveAIKey,
  resolveRepoRoot,
  str,
  writeDebugArtifact,
} from './pipeline-shared.js';
import {
  type EvalInput,
  loadTasksmithInputs,
  loadTasksmithTaskFile,
} from './tasksmith.js';

// ── Args ──────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  allowPositionals: false,
  options: {
    eval: { type: 'string' },
    'task-id': { type: 'string', multiple: true },
    'task-file': { type: 'string', multiple: true },
    'task-source': { type: 'string', default: 'evals' },
    'task-status': { type: 'string', default: 'verified' },
    families: { type: 'string' },
    'pack-file': { type: 'string' },
    'diary-id': { type: 'string' },
    'student-provider': { type: 'string' },
    'teacher-provider': { type: 'string' },
    'ai-key': { type: 'string' },
    'student-model': { type: 'string' },
    'teacher-model': { type: 'string' },
    'claude-model': { type: 'string', default: 'claude-sonnet-4-6' },
    'max-evals': { type: 'string', default: '30' },
    'num-trials': { type: 'string', default: '8' },
    baseline: { type: 'boolean', default: false },
    'debug-traces': { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '1' },
  },
  strict: false,
});

const repoRoot = await resolveRepoRoot();
await loadEnvLocal(repoRoot);
const envConfig = loadContextEvalsConfig();

const evalArg = str(values['eval']);
const taskIdArgs = Array.isArray(values['task-id'])
  ? values['task-id'].filter(
      (value): value is string => typeof value === 'string',
    )
  : typeof values['task-id'] === 'string'
    ? [values['task-id']]
    : [];
const taskFileArgs = Array.isArray(values['task-file'])
  ? values['task-file'].filter(
      (value): value is string => typeof value === 'string',
    )
  : typeof values['task-file'] === 'string'
    ? [values['task-file']]
    : [];
if (!evalArg && taskIdArgs.length === 0 && taskFileArgs.length === 0) {
  console.error(
    'Usage: pnpm gpack (--eval <eval-name> | --task-id <id> | --task-file <path>) [options]',
  );
  process.exit(1);
}
const taskSource = str(values['task-source']) || 'evals';
const taskStatus = str(values['task-status']) || 'verified';
const packFileArg = str(values['pack-file']);
const familyFilter = new Set(
  str(values['families'])
    .split(',')
    .map((family) => family.trim())
    .filter(Boolean),
);
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
const debugTraces = values['debug-traces'] === true;
const verbose = values['verbose'] === true;
const concurrency = Math.max(
  1,
  parseInt(str(values['concurrency']) || '1', 10) || 1,
);

// ── API client ────────────────────────────────────────────────────────────────

let _apiClient: Awaited<ReturnType<typeof createAuthedClient>> | null = null;

async function getApiClient(): Promise<
  Awaited<ReturnType<typeof createAuthedClient>>
> {
  if (_apiClient) return _apiClient;
  _apiClient = await createAuthedClient();
  return _apiClient;
}

// ── Diary ID resolution ───────────────────────────────────────────────────────

async function resolveDiaryId(): Promise<string> {
  const explicit = str(values['diary-id']) || envConfig.MOLTNET_DIARY_ID || '';
  if (explicit) return explicit;

  const repoName = repoRoot.split('/').at(-1) ?? 'unknown-repo';

  const { data, error } = await listDiaries({ client: await getApiClient() });
  if (error || !data)
    throw new Error(`listDiaries failed: ${JSON.stringify(error)}`);

  const diary = data.items.find((d: { name: string }) => d.name === repoName);
  if (!diary)
    throw new Error(
      `No diary named "${repoName}" found. Pass --diary-id explicitly or create a diary first.`,
    );
  return diary.id;
}

// ── Scenario loading ──────────────────────────────────────────────────────────

const NonEmptyString = Type.String({ minLength: 1 });
const NonEmptyStringArray = Type.Array(NonEmptyString);

const ScenarioSchema = Type.Object(
  {
    fixture: Type.Object({
      ref: NonEmptyString,
    }),
    setup: Type.Optional(
      Type.Object({
        commands: NonEmptyStringArray,
      }),
    ),
    validation: Type.Object({
      commands: Type.Array(NonEmptyString, { minItems: 1 }),
      pass_to_pass: Type.Optional(NonEmptyStringArray),
      regression_commands: Type.Optional(NonEmptyStringArray),
    }),
    context_variants: Type.Optional(
      Type.Object(
        {
          combined: Type.Optional(
            Type.Object({
              source: NonEmptyString,
              layers: Type.Optional(
                Type.Array(
                  Type.Object({
                    include_tags: NonEmptyStringArray,
                    token_budget: Type.Number(),
                  }),
                ),
              ),
              include_tags: Type.Optional(NonEmptyStringArray),
              token_budget: Type.Optional(Type.Number()),
            }),
          ),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
);

type Scenario = Static<typeof ScenarioSchema>;

const TaskPromptSchema = NonEmptyString;

const GpackTaskSchema = Type.Object({
  id: NonEmptyString,
  baseCommit: NonEmptyString,
  problemStatement: NonEmptyString,
  failToPass: Type.Array(NonEmptyString, { minItems: 1 }),
  passToPass: NonEmptyStringArray,
  setup: Type.Optional(NonEmptyStringArray),
});

async function loadScenario(dir: string): Promise<Scenario> {
  return JSON.parse(await readFile(`${dir}/scenario.json`, 'utf8')) as Scenario;
}

async function loadTaskPrompt(dir: string): Promise<string> {
  return readFile(`${dir}/task.md`, 'utf8');
}

function formatTypeboxErrors(
  schema: Parameters<typeof Value.Errors>[0],
  evalName: string,
  value: unknown,
): never {
  const [firstError] = Array.from(Value.Errors(schema, value)) as Array<
    { path?: string; message?: string } | undefined
  >;
  const path = firstError?.path || '/';
  const message = firstError?.message || 'invalid value';
  throw new Error(`[gpack] ${evalName}: ${path} ${message}`);
}

function validateScenario(
  evalName: string,
  scenario: unknown,
): asserts scenario is Scenario {
  if (!Value.Check(ScenarioSchema, scenario)) {
    formatTypeboxErrors(ScenarioSchema, evalName, scenario);
  }
}

function validateTaskPrompt(
  evalName: string,
  taskPrompt: unknown,
): asserts taskPrompt is string {
  if (!Value.Check(TaskPromptSchema, taskPrompt)) {
    formatTypeboxErrors(TaskPromptSchema, evalName, taskPrompt);
  }
}

function validateTask(task: unknown): asserts task is GpackTask {
  if (!Value.Check(GpackTaskSchema, task)) {
    const [firstError] = Array.from(
      Value.Errors(GpackTaskSchema, task),
    ) as Array<{ path?: string; message?: string } | undefined>;
    const path = firstError?.path || '/';
    const message = firstError?.message || 'invalid task';
    const taskId =
      typeof (task as { id?: unknown })?.id === 'string'
        ? (task as { id: string }).id
        : 'unknown-task';
    throw new Error(`[gpack] ${taskId}: ${path} ${message}`);
  }
}

// ── Task building ─────────────────────────────────────────────────────────────

function buildTask(
  name: string,
  scenario: Scenario,
  taskPrompt: string,
): GpackTask {
  const regressionCommands =
    scenario.validation?.pass_to_pass ??
    scenario.validation?.regression_commands ??
    [];

  return {
    id: name,
    baseCommit: scenario.fixture.ref,
    problemStatement: taskPrompt,
    failToPass: scenario.validation?.commands ?? [],
    passToPass: regressionCommands,
    setup: scenario.setup?.commands,
  };
}

async function loadEvalInputs(spec: string): Promise<EvalInput[]> {
  const names =
    spec === 'all'
      ? (await readdir(resolve(repoRoot, 'evals'), { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : spec
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean);

  if (names.length === 0) {
    throw new Error(
      `No evals resolved from --eval "${spec}". Use a valid eval name, comma-separated list, or "all".`,
    );
  }

  const inputs: EvalInput[] = [];
  for (const name of names) {
    const dir = resolve(repoRoot, 'evals', name);
    const scenario = await loadScenario(dir);
    const taskPrompt = await loadTaskPrompt(dir);
    validateScenario(name, scenario);
    validateTaskPrompt(name, taskPrompt);
    const task = buildTask(name, scenario, taskPrompt);
    inputs.push({ name, task, taskPrompt });
  }

  return inputs;
}

async function loadInputs(spec: string): Promise<EvalInput[]> {
  if (taskFileArgs.length > 0) {
    const inputs = await Promise.all(
      taskFileArgs.map((taskFile) => loadTasksmithTaskFile(repoRoot, taskFile)),
    );
    return inputs;
  }

  if (taskIdArgs.length > 0) {
    return loadTasksmithInputs(repoRoot, taskIdArgs.join(','), {
      taskStatus,
      familyFilter,
    });
  }

  if (taskSource === 'tasksmith') {
    return loadTasksmithInputs(repoRoot, spec, { taskStatus, familyFilter });
  }

  return loadEvalInputs(spec);
}

// ── Seed pack compilation ─────────────────────────────────────────────────────

async function compileSeedPack(
  diaryId: string,
  taskPrompt: string,
  includeTags: string[],
  tokenBudget: number,
): Promise<string> {
  const { data, error } = await compileDiary({
    client: await getApiClient(),
    path: { id: diaryId },
    body: {
      tokenBudget,
      includeTags,
      taskPrompt: taskPrompt.slice(0, 2000),
    },
  });

  if (error || !data) {
    console.warn(`[gpack] compileDiary failed: ${JSON.stringify(error)}`);
    return '';
  }

  // TODO: pack entries no longer include content. This needs the pack
  // expansion endpoint (GET /packs/:id?expand=entries) to fetch content.
  // For now, return a stub with entry metadata only.
  return data.entries
    .map(
      (e) =>
        `---\n## ${e.entryId.slice(0, 8)} (${e.compressionLevel})\n\nCID: ${e.entryCidSnapshot}\n`,
    )
    .join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const evalSpec = evalArg || 'all';
  const evalInputs = await loadInputs(evalSpec);
  if (evalInputs.length === 0) {
    throw new Error(
      `[gpack] no tasks resolved from selection with --task-source ${taskSource}`,
    );
  }
  const tasks = evalInputs.map((input) => input.task);
  for (const task of tasks) {
    validateTask(task);
  }

  const seedTaskPrompt = evalInputs
    .map((input) => `## ${input.name}\n\n${input.taskPrompt}`)
    .join('\n\n')
    .slice(0, 8000);

  const combinedVariant =
    taskSource === 'evals'
      ? (await loadScenario(resolve(repoRoot, 'evals', evalInputs[0].name)))
          .context_variants?.combined
      : undefined;

  const adapter = new MoltNetContextAdapter({
    verbose,
    claudeModel,
    concurrency,
  });
  const explicitPack = packFileArg
    ? await loadPackFile(repoRoot, packFileArg)
    : '';

  if (runBaselineMode) {
    if (packFileArg) {
      console.log(
        `[gpack] running pack eval from ${resolve(repoRoot, packFileArg)}...`,
      );
    } else {
      console.log('[gpack] running baseline (empty pack)...');
    }
    const baselineResult = await runBaseline(adapter, tasks, explicitPack);
    if (debugTraces) {
      await writeDebugArtifact(
        repoRoot,
        `${packFileArg ? 'gpack-pack' : 'gpack-baseline'}-${Date.now()}.json`,
        {
          phase: 'baseline',
          evals: evalInputs.map((input) => input.name),
          scores: baselineResult.scores,
          averageScore: baselineResult.averageScore,
          traces: baselineResult.trajectories ?? [],
        },
      );
    }
    console.log(
      `[gpack] ${packFileArg ? 'pack' : 'baseline'} scores: ${baselineResult.scores
        .map((s) => s.toFixed(2))
        .join(', ')} avg=${baselineResult.averageScore.toFixed(2)}`,
    );
    return;
  }

  let seedPack = '';
  if (explicitPack) {
    console.log(
      `[gpack] evals=${evalInputs.map((e) => e.name).join(',')} seed=${resolve(repoRoot, packFileArg)} maxMetricCalls=${maxMetricCalls} numTrials=${numTrials}`,
    );
    seedPack = explicitPack;
  } else {
    // Resolve diary ID (explicit flag > env var > auto-detect from repo name)
    const diaryId = await resolveDiaryId();

    console.log(
      `[gpack] evals=${evalInputs.map((e) => e.name).join(',')} diary=${diaryId} maxMetricCalls=${maxMetricCalls} numTrials=${numTrials}`,
    );

    // Compile seed pack from diary
    console.log('[gpack] compiling seed pack from diary...');
    if (combinedVariant?.source === 'multi_compile' && combinedVariant.layers) {
      const parts: string[] = [];
      for (const layer of combinedVariant.layers) {
        parts.push(
          await compileSeedPack(
            diaryId,
            seedTaskPrompt,
            layer.include_tags,
            layer.token_budget,
          ),
        );
      }
      seedPack = parts.join('\n');
    } else {
      seedPack = await compileSeedPack(
        diaryId,
        seedTaskPrompt,
        combinedVariant?.include_tags ?? ['source:tile', 'source:nugget'],
        combinedVariant?.token_budget ?? 16000,
      );
    }
  }
  console.log(`[gpack] seed pack: ${seedPack.length} chars`);

  // Build AI models for GEPA optimization.
  // studentAI: cheap model the ax() program targets (passthrough in our case).
  // teacherAI: more capable model that proposes improved instructions during
  //            reflection. Optional but recommended for better optimization.
  if (!studentProvider) {
    throw new Error(
      '[gpack] GEPA optimization requires --student-provider (openai, anthropic, google-gemini, claude-agent-sdk, or codex-agent-sdk).',
    );
  }
  const studentAI = buildAI({
    provider: studentProvider,
    aiKey,
    model: studentModel,
  });
  if (teacherModel && !teacherProvider) {
    throw new Error('[gpack] --teacher-model requires --teacher-provider.');
  }
  const teacherAI =
    teacherModel && teacherProvider
      ? buildAI({
          provider: teacherProvider,
          aiKey: resolveAIKey(str(values['ai-key']), teacherProvider),
          model: teacherModel,
        })
      : undefined;

  console.log(
    `[gpack] starting GEPA optimization (numTrials=${numTrials} maxMetricCalls=${maxMetricCalls})...`,
  );

  const { bestScore, bestInstruction } = await runGepaOptimization({
    tasks,
    adapter,
    seedInstruction: seedPack,
    studentAI,
    teacherAI,
    numTrials,
    maxMetricCalls,
    verbose,
    axSignature:
      'id:string, baseCommit:string, problemStatement:string, failToPass:json, passToPass:json, setup?:json -> sessionPack:string "Context pack content"',
    buildExamples: (trainingTasks) =>
      trainingTasks.map((task) => ({
        id: task.id,
        baseCommit: task.baseCommit,
        problemStatement: task.problemStatement,
        failToPass: task.failToPass,
        passToPass: task.passToPass,
        setup: task.setup,
      })),
    evaluateOne: async (task, instruction) => {
      const evalResult = await adapter.evaluate([task], { instruction }, true);
      return {
        score: evalResult.scores[0] ?? 0,
        trace: evalResult.trajectories?.[0],
      };
    },
  });

  console.log(`\n[gpack] optimization complete`);
  console.log(`  best score: ${bestScore.toFixed(3)}`);

  const outDir = resolve(repoRoot, 'evals', 'runs');
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, `gpack-optimized-${Date.now()}.md`);
  await writeFile(outPath, bestInstruction, 'utf8');
  console.log(`[gpack] best pack saved to ${outPath}`);

  // Evaluate best pack once on the canonical task set (no synthetic replica)
  const finalEval = await runBaseline(adapter, tasks, bestInstruction);
  if (debugTraces) {
    await writeDebugArtifact(repoRoot, `gpack-final-${Date.now()}.json`, {
      phase: 'final',
      evals: evalInputs.map((input) => input.name),
      scores: finalEval.scores,
      averageScore: finalEval.averageScore,
      traces: finalEval.trajectories ?? [],
    });
  }
  console.log(
    `[gpack] final scores: ${finalEval.scores.map((s) => s.toFixed(2)).join(', ')} avg=${finalEval.averageScore.toFixed(3)}`,
  );

  console.log(
    `[gpack] next step: review and promote with pnpm gpack:promote --entry <diary-entry-id>`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
