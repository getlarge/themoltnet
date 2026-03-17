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

import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { ax, AxGEPA } from '@ax-llm/ax';
import { compileDiary, listDiaries } from '@moltnet/api-client';
import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { MoltNetContextAdapter } from './adapter.js';
import { createAuthedClient } from './client.js';
import { loadContextEvalsConfig } from './config.js';
import type { GpackTask } from './evaluate.js';
import {
  buildAI,
  buildAverage,
  buildCacheKey,
  loadEnvLocal,
  loadPackFile,
  resolveRepoRoot,
  str,
  writeDebugArtifact,
} from './pipeline-shared.js';

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
    'ai-key': { type: 'string' },
    model: { type: 'string' },
    'teacher-model': { type: 'string' },
    'claude-model': { type: 'string', default: 'claude-sonnet-4-6' },
    'max-evals': { type: 'string', default: '30' },
    'num-trials': { type: 'string', default: '8' },
    baseline: { type: 'boolean', default: false },
    'debug-traces': { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
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
const aiKey =
  str(values['ai-key']) ||
  envConfig.GOOGLE_API_KEY ||
  envConfig.OPENAI_API_KEY ||
  envConfig.ANTHROPIC_API_KEY ||
  envConfig.DASHSCOPE_API_KEY ||
  '';
const studentModel = str(values['model']);
const teacherModel = str(values['teacher-model']);
const claudeModel =
  str(values['claude-model']) ||
  envConfig.GPACK_AGENT_MODEL ||
  'claude-sonnet-4-6';
const maxMetricCalls = parseInt(str(values['max-evals']) || '30', 10);
const numTrials = parseInt(str(values['num-trials']) || '8', 10);
const runBaseline = values['baseline'] === true;
const debugTraces = values['debug-traces'] === true;
const verbose = values['verbose'] === true;

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

interface EvalInput {
  name: string;
  task: GpackTask;
  taskPrompt: string;
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

const TasksmithTaskSchema = Type.Object({
  task_id: NonEmptyString,
  fixture_ref: NonEmptyString,
  gold_fix_ref: NonEmptyString,
  source_commit_ref: NonEmptyString,
  source_commit_refs: Type.Optional(NonEmptyStringArray),
  problem_statement: NonEmptyString,
  family: NonEmptyString,
  secondary_families: Type.Optional(NonEmptyStringArray),
  subsystems: Type.Optional(NonEmptyStringArray),
  changed_files: Type.Optional(NonEmptyStringArray),
  fail_to_pass: Type.Array(NonEmptyString, { minItems: 1 }),
  pass_to_pass: Type.Array(NonEmptyString),
  diary_entry_ids: Type.Optional(NonEmptyStringArray),
  confidence: Type.Optional(NonEmptyString),
});

type TasksmithTask = Static<typeof TasksmithTaskSchema>;

function validateTasksmithTask(
  taskName: string,
  task: unknown,
): asserts task is TasksmithTask {
  if (!Value.Check(TasksmithTaskSchema, task)) {
    formatTypeboxErrors(TasksmithTaskSchema, taskName, task);
  }
}

async function loadTasksmithInputs(spec: string): Promise<EvalInput[]> {
  const taskDir = resolve(repoRoot, 'tasksmith', 'candidates', 'tasks');
  const verifiedDir = resolve(repoRoot, 'tasksmith', 'verified');
  const names =
    spec === 'all'
      ? (await readdir(taskDir, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) => entry.name.replace(/\.json$/, ''))
      : spec
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean);

  const allowedByStatus =
    taskStatus === 'verified'
      ? new Set(
          (await readdir(verifiedDir, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => entry.name.replace(/\.json$/, '')),
        )
      : null;

  const inputs: EvalInput[] = [];
  for (const name of names) {
    const path = resolve(taskDir, `${name}.json`);
    try {
      await access(path);
    } catch {
      continue;
    }
    if (allowedByStatus && !allowedByStatus.has(name)) continue;
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
    validateTasksmithTask(name, raw);
    if (familyFilter.size > 0 && !familyFilter.has(raw.family)) continue;

    const task: GpackTask = {
      id: raw.task_id,
      baseCommit: raw.fixture_ref,
      problemStatement: raw.problem_statement,
      failToPass: raw.fail_to_pass,
      passToPass: raw.pass_to_pass,
      setup:
        raw.fail_to_pass.some((cmd) => cmd.includes('pnpm')) ||
        raw.pass_to_pass.some((cmd) => cmd.includes('pnpm'))
          ? ['pnpm install --frozen-lockfile']
          : [],
    };
    inputs.push({
      name: raw.task_id,
      task,
      taskPrompt: raw.problem_statement,
    });
  }

  return inputs;
}

async function loadTasksmithTaskFile(taskFile: string): Promise<EvalInput> {
  const resolvedPath = resolve(repoRoot, taskFile);
  const raw = JSON.parse(await readFile(resolvedPath, 'utf8')) as unknown;
  const taskName =
    resolvedPath
      .split('/')
      .at(-1)
      ?.replace(/\.json$/, '') ?? taskFile;
  validateTasksmithTask(taskName, raw);

  const task: GpackTask = {
    id: raw.task_id,
    baseCommit: raw.fixture_ref,
    problemStatement: raw.problem_statement,
    failToPass: raw.fail_to_pass,
    passToPass: raw.pass_to_pass,
    setup:
      raw.fail_to_pass.some((cmd) => cmd.includes('pnpm')) ||
      raw.pass_to_pass.some((cmd) => cmd.includes('pnpm'))
        ? ['pnpm install --frozen-lockfile']
        : [],
  };

  return {
    name: raw.task_id,
    task,
    taskPrompt: raw.problem_statement,
  };
}

async function loadInputs(spec: string): Promise<EvalInput[]> {
  if (taskFileArgs.length > 0) {
    const inputs = await Promise.all(
      taskFileArgs.map((taskFile) => loadTasksmithTaskFile(taskFile)),
    );
    return inputs;
  }

  if (taskIdArgs.length > 0) {
    return loadTasksmithInputs(taskIdArgs.join(','));
  }

  if (taskSource === 'tasksmith') {
    return loadTasksmithInputs(spec);
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

  // GEPA requires at least 2 examples for train/validation split.
  // For single-task optimization, duplicate the task as a synthetic second
  // sample so the optimizer can still run.
  const trainingTasks: GpackTask[] =
    tasks.length >= 2
      ? tasks
      : [{ ...tasks[0] }, { ...tasks[0], id: `${tasks[0].id}-replica` }];

  const adapter = new MoltNetContextAdapter({ verbose, claudeModel });
  const explicitPack = packFileArg
    ? await loadPackFile(repoRoot, packFileArg)
    : '';

  if (runBaseline) {
    if (packFileArg) {
      console.log(
        `[gpack] running pack eval from ${resolve(repoRoot, packFileArg)}...`,
      );
    } else {
      console.log('[gpack] running baseline (empty pack)...');
    }
    const result = await adapter.evaluate(
      tasks,
      { instruction: explicitPack },
      true,
    );
    const averageScore = buildAverage(result.scores);
    if (debugTraces) {
      await writeDebugArtifact(
        repoRoot,
        `${packFileArg ? 'gpack-pack' : 'gpack-baseline'}-${Date.now()}.json`,
        {
          phase: 'baseline',
          evals: evalInputs.map((input) => input.name),
          scores: result.scores,
          averageScore,
          traces: result.trajectories ?? [],
        },
      );
    }
    console.log(
      `[gpack] ${packFileArg ? 'pack' : 'baseline'} scores: ${result.scores
        .map((s) => s.toFixed(2))
        .join(', ')} avg=${averageScore.toFixed(2)}`,
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
  const studentAI = buildAI({ aiKey, model: studentModel });
  const teacherAI = teacherModel
    ? buildAI({ aiKey, model: teacherModel })
    : undefined;

  // Build a passthrough ax() program with the seed pack as its instruction.
  // GEPA extracts getBaseInstruction() from the program's instruction text,
  // so setting it here seeds the optimization with our compiled context pack.
  const passthrough = ax(
    'id:string, baseCommit:string, problemStatement:string, failToPass:json, passToPass:json, setup?:json -> sessionPack:string "Context pack content"',
  );
  passthrough.setInstruction(seedPack);

  const optimizer = new AxGEPA({
    studentAI,
    ...(teacherAI ? { teacherAI } : {}),
    numTrials,
    verbose,
    seed: 42,
  });

  type GepaExample = Record<string, unknown> & {
    id: string;
    baseCommit: string;
    problemStatement: string;
    failToPass: string[];
    passToPass: string[];
    setup?: string[];
  };

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const trainingExamples = trainingTasks.map(
    (task) =>
      ({
        id: task.id,
        baseCommit: task.baseCommit,
        problemStatement: task.problemStatement,
        failToPass: task.failToPass,
        passToPass: task.passToPass,
        setup: task.setup,
      }) satisfies GepaExample,
  );

  console.log(
    `[gpack] starting GEPA optimization (numTrials=${numTrials} maxMetricCalls=${maxMetricCalls})...`,
  );

  const metricCache = new Map<string, number>();
  const getCurrentInstruction = (): string =>
    (passthrough as { instruction?: string }).instruction ?? seedPack;

  const result = await optimizer.compile(
    passthrough,
    trainingExamples,
    async ({ example }) => {
      const taskId =
        typeof example.id === 'string'
          ? example.id.replace(/-replica$/, '')
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
  const bestPack = result.optimizedProgram?.instruction ?? seedPack;

  console.log(`\n[gpack] optimization complete`);
  console.log(`  best score: ${bestScore.toFixed(3)}`);

  const outDir = resolve(repoRoot, 'evals', 'runs');
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, `gpack-optimized-${Date.now()}.md`);
  await writeFile(outPath, bestPack, 'utf8');
  console.log(`[gpack] best pack saved to ${outPath}`);

  // Evaluate best pack once on the canonical task set (no synthetic replica)
  const finalEval = await adapter.evaluate(
    tasks,
    { instruction: bestPack },
    true,
  );
  const finalAvg = buildAverage(finalEval.scores);
  if (debugTraces) {
    await writeDebugArtifact(repoRoot, `gpack-final-${Date.now()}.json`, {
      phase: 'final',
      evals: evalInputs.map((input) => input.name),
      scores: finalEval.scores,
      averageScore: finalAvg,
      traces: finalEval.trajectories ?? [],
    });
  }
  console.log(
    `[gpack] final scores: ${finalEval.scores.map((s) => s.toFixed(2)).join(', ')} avg=${finalAvg.toFixed(3)}`,
  );

  console.log(
    `[gpack] next step: review and promote with pnpm gpack:promote --entry <diary-entry-id>`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
