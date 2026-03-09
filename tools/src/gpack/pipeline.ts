#!/usr/bin/env -S npx tsx
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
 *
 * Environment variables:
 *   MOLTNET_CREDENTIALS_PATH   path to moltnet.json credentials
 *   MOLTNET_DIARY_ID           diary UUID to compile context from
 *   OPENAI_API_KEY             OpenAI API key for GEPA reflection LLM
 *   ANTHROPIC_API_KEY          Anthropic API key (alternative to OpenAI)
 *   GPACK_AGENT_MODEL          model string (default: gpt-4o-mini)
 */

import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  ax,
  AxAI,
  AxAIAnthropicModel,
  AxAIOpenAIModel,
  type AxFieldValue,
  AxGEPA,
} from '@ax-llm/ax';
import {
  compileDiary,
  createClient,
  createConfig,
  listDiaries,
} from '@moltnet/api-client';
import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { MoltNetContextAdapter } from './adapter.js';
import type { EvalTrace, GpackTask } from './evaluate.js';

// ── Args ──────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  allowPositionals: false,
  options: {
    eval: { type: 'string' },
    'diary-id': { type: 'string' },
    'ai-key': { type: 'string' },
    model: { type: 'string' },
    'claude-model': { type: 'string', default: 'claude-sonnet-4-6' },
    'max-evals': { type: 'string', default: '30' },
    'num-trials': { type: 'string', default: '8' },
    baseline: { type: 'boolean', default: false },
    'debug-traces': { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
  },
  strict: false,
});

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const repoRoot = execSync('git rev-parse --show-toplevel', {
  encoding: 'utf8',
}).trim();
const envLocalPath = resolve(repoRoot, '.env.local');

if (existsSync(envLocalPath)) {
  process.loadEnvFile(envLocalPath);
}

const evalArg = str(values['eval']);
if (!evalArg) {
  console.error('Usage: pnpm gpack --eval <eval-name> [options]');
  process.exit(1);
}
const aiKey =
  str(values['ai-key']) ||
  process.env.OPENAI_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  process.env.DASHSCOPE_API_KEY ||
  '';
const claudeModel = str(values['claude-model']) || 'claude-sonnet-4-6';
const maxMetricCalls = parseInt(str(values['max-evals']) || '30', 10);
const numTrials = parseInt(str(values['num-trials']) || '8', 10);
const runBaseline = values['baseline'] === true;
const debugTraces = values['debug-traces'] === true;
const verbose = values['verbose'] === true;

// ── Credentials + API client ──────────────────────────────────────────────────

interface MoltnetCredentials {
  oauth2: { client_id: string; client_secret: string };
  endpoints: { api: string };
}

function resolveCredentialsPath(): string {
  if (process.env.MOLTNET_CREDENTIALS_PATH) {
    return resolve(process.env.MOLTNET_CREDENTIALS_PATH);
  }

  return resolve(repoRoot, '.moltnet/legreffier/moltnet.json');
}

let credentials: MoltnetCredentials | null = null;
let apiClient: ReturnType<typeof createClient> | null = null;

function getCredentials(): MoltnetCredentials {
  if (credentials) return credentials;
  const loadedCredentials: MoltnetCredentials = JSON.parse(
    readFileSync(resolveCredentialsPath(), 'utf8'),
  );
  credentials = loadedCredentials;
  return loadedCredentials;
}

// ── API client with cached OAuth2 token interceptor ───────────────────────────

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

async function fetchToken(): Promise<string> {
  const currentCredentials = getCredentials();
  const apiUrl = currentCredentials.endpoints.api;
  if (_cachedToken && Date.now() < _tokenExpiresAt) return _cachedToken;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: currentCredentials.oauth2.client_id,
    client_secret: currentCredentials.oauth2.client_secret,
    scope: 'diary:read diary:write',
  });
  const res = await fetch(`${apiUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`OAuth2 failed: ${await res.text()}`);
  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  _cachedToken = data.access_token;
  _tokenExpiresAt = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
  return _cachedToken;
}

function getApiClient(): ReturnType<typeof createClient> {
  if (apiClient) return apiClient;

  const currentCredentials = getCredentials();
  apiClient = createClient(
    createConfig({ baseUrl: currentCredentials.endpoints.api }),
  );
  apiClient.interceptors.request.use(async (request) => {
    const token = await fetchToken();
    request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  });

  return apiClient;
}

// ── Diary ID resolution ───────────────────────────────────────────────────────

async function resolveDiaryId(): Promise<string> {
  const explicit =
    str(values['diary-id']) || process.env.MOLTNET_DIARY_ID || '';
  if (explicit) return explicit;

  const repoName = execSync('git rev-parse --show-toplevel', {
    encoding: 'utf8',
  })
    .trim()
    .split('/')
    .at(-1)!;

  const { data, error } = await listDiaries({ client: getApiClient() });
  if (error || !data)
    throw new Error(`listDiaries failed: ${JSON.stringify(error)}`);

  const diary = data.items.find((d: { name: string }) => d.name === repoName);
  if (!diary)
    throw new Error(
      `No diary named "${repoName}" found. Pass --diary-id explicitly or create a diary first.`,
    );
  return diary.id as string;
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

function loadScenario(dir: string): Scenario {
  return JSON.parse(readFileSync(`${dir}/scenario.json`, 'utf8'));
}

function loadTaskPrompt(dir: string): string {
  return readFileSync(`${dir}/task.md`, 'utf8');
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
  dir: string;
  scenario: Scenario;
  taskPrompt: string;
}

function loadEvalInputs(spec: string): EvalInput[] {
  const names =
    spec === 'all'
      ? readdirSync(resolve(repoRoot, 'evals'), { withFileTypes: true })
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
    const scenario = loadScenario(dir);
    const taskPrompt = loadTaskPrompt(dir);
    validateScenario(name, scenario);
    validateTaskPrompt(name, taskPrompt);
    inputs.push({ name, dir, scenario, taskPrompt });
  }

  return inputs;
}

// ── Seed pack compilation ─────────────────────────────────────────────────────

async function compileSeedPack(
  diaryId: string,
  taskPrompt: string,
  includeTags: string[],
  tokenBudget: number,
): Promise<string> {
  const { data, error } = await compileDiary({
    client: getApiClient(),
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

  return data.entries
    .map(
      (e: { id: string; content: string }) =>
        `---\n## ${e.id.slice(0, 8)}\n\n${e.content}\n`,
    )
    .join('\n');
}

interface DebugTraceArtifact {
  phase: 'baseline' | 'final';
  evals: string[];
  scores: number[];
  averageScore: number;
  traces: EvalTrace[];
}

function buildAverage(scores: number[]): number {
  return (
    scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length)
  );
}

function writeDebugArtifact(
  artifactName: string,
  artifact: DebugTraceArtifact,
): void {
  const outDir = resolve(repoRoot, 'evals', 'runs');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, artifactName);
  writeFileSync(outPath, JSON.stringify(artifact, null, 2), 'utf8');
  console.log(`[gpack] debug traces saved to ${outPath}`);
}

// ── AI provider ───────────────────────────────────────────────────────────────

// Qwen via DashScope OpenAI-compatible endpoint
const QWEN_API_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const QWEN_DEFAULT_MODEL = 'qwen-plus' as const;

function buildAI(): AxAI {
  const key = aiKey;
  if (!key) {
    throw new Error(
      'No AI key found. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or DASHSCOPE_API_KEY, or pass --ai-key',
    );
  }

  // Qwen / DashScope key (starts with "sk-" but routed via dashscope)
  if (process.env.DASHSCOPE_API_KEY === key) {
    return AxAI.create({
      name: 'openai',
      apiKey: key,
      apiURL: QWEN_API_URL,
      config: { model: QWEN_DEFAULT_MODEL as AxAIOpenAIModel },
    });
  }

  if (key.startsWith('sk-ant-') || process.env.ANTHROPIC_API_KEY === key) {
    return AxAI.create({
      name: 'anthropic',
      apiKey: key,
      config: { model: AxAIAnthropicModel.Claude35Haiku },
    });
  }

  return AxAI.create({
    name: 'openai',
    apiKey: key,
    config: { model: AxAIOpenAIModel.GPT4OMini },
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const evalInputs = loadEvalInputs(evalArg);
  const tasks = evalInputs.map((input) =>
    buildTask(input.name, input.scenario, input.taskPrompt),
  );
  for (const task of tasks) {
    validateTask(task);
  }

  const seedTaskPrompt = evalInputs
    .map((input) => `## ${input.name}\n\n${input.taskPrompt}`)
    .join('\n\n')
    .slice(0, 8000);

  const combinedVariant = evalInputs[0]?.scenario.context_variants?.combined;

  // GEPA requires at least 2 examples for train/validation split.
  // For single-task optimization, duplicate the task as a synthetic second
  // sample so the optimizer can still run.
  const trainingTasks: GpackTask[] =
    tasks.length >= 2
      ? tasks
      : [{ ...tasks[0]! }, { ...tasks[0]!, id: `${tasks[0]!.id}-replica` }];

  const adapter = new MoltNetContextAdapter({ verbose, claudeModel });

  if (runBaseline) {
    console.log('[gpack] running baseline (empty pack)...');
    const result = await adapter.evaluate(tasks, { instruction: '' }, true);
    const averageScore = buildAverage(result.scores);
    if (debugTraces) {
      writeDebugArtifact(`gpack-baseline-${Date.now()}.json`, {
        phase: 'baseline',
        evals: evalInputs.map((input) => input.name),
        scores: result.scores,
        averageScore,
        traces: result.trajectories ?? [],
      });
    }
    console.log(
      `[gpack] baseline scores: ${result.scores.map((s) => s.toFixed(2)).join(', ')} avg=${averageScore.toFixed(
        2,
      )}`,
    );
    return;
  }

  // Resolve diary ID (explicit flag > env var > auto-detect from repo name)
  const diaryId = await resolveDiaryId();

  console.log(
    `[gpack] evals=${evalInputs.map((e) => e.name).join(',')} diary=${diaryId} maxMetricCalls=${maxMetricCalls} numTrials=${numTrials}`,
  );

  // Compile seed pack from diary
  console.log('[gpack] compiling seed pack from diary...');
  let seedPack = '';

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
  console.log(`[gpack] seed pack: ${seedPack.length} chars`);

  // Build the student AI for GEPA reflection
  const studentAI = buildAI();

  // Build a passthrough ax() program with the seed pack as its instruction.
  // GEPA extracts getBaseInstruction() from the program's instruction text,
  // so setting it here seeds the optimization with our compiled context pack.
  const passthrough = ax(
    'id:string, baseCommit:string, problemStatement:string, failToPass:json, passToPass:json, setup?:json -> sessionPack:string "Context pack content"',
  );
  passthrough.setInstruction(seedPack);

  const optimizer = new AxGEPA({
    studentAI,
    numTrials,
    verbose,
    seed: 42,
  });

  type GepaExample = Record<string, AxFieldValue> & {
    id: string;
    baseCommit: string;
    problemStatement: string;
    failToPass: AxFieldValue;
    passToPass: AxFieldValue;
    setup?: AxFieldValue;
  };

  const trainingExamples = trainingTasks.map((task) => ({
    id: task.id,
    baseCommit: task.baseCommit,
    problemStatement: task.problemStatement,
    failToPass: task.failToPass,
    passToPass: task.passToPass,
    setup: task.setup,
  })) as GepaExample[];

  console.log(
    `[gpack] starting GEPA optimization (numTrials=${numTrials} maxMetricCalls=${maxMetricCalls})...`,
  );

  // The training examples are the GpackTask objects.
  // The metric fn is a no-op because the adapter's evaluate() is the real scorer.
  // GEPA calls adapter.evaluate(examples, { instruction: <candidate> }, captureTraces).
  const result = await optimizer.compile(
    passthrough,
    trainingExamples,
    () => 0,
    {
      maxMetricCalls,
      gepaAdapter: adapter,
      feedbackExamples: trainingExamples,
    },
  );

  const bestScore = result.bestScore;
  const bestPack = result.optimizedProgram?.instruction ?? seedPack;

  console.log(`\n[gpack] optimization complete`);
  console.log(`  best score: ${bestScore.toFixed(3)}`);

  const outDir = resolve(repoRoot, 'evals', 'runs');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `gpack-optimized-${Date.now()}.md`);
  writeFileSync(outPath, bestPack, 'utf8');
  console.log(`[gpack] best pack saved to ${outPath}`);

  // Evaluate best pack once on the canonical task set (no synthetic replica)
  const finalEval = await adapter.evaluate(
    tasks,
    { instruction: bestPack },
    true,
  );
  const finalAvg = buildAverage(finalEval.scores);
  if (debugTraces) {
    writeDebugArtifact(`gpack-final-${Date.now()}.json`, {
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
