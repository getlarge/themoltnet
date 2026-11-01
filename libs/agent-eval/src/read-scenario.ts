/**
 * Reader for `evals-v2/<slug>/` scenario directories. Fails loudly on any
 * drift — a missing file, malformed JSON, a schema violation, or a rubric
 * whose weights do not sum to 1. This is the deliberate opposite of the
 * orphaned `tools/src/tasks/scenario.ts`, which silently dropped fields.
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { runtimeProfileContextRecipeIds } from '@moltnet/runtime-profiles';
import {
  Rubric,
  RunEvalExecution,
  validateOutputContract,
  validateRubricWeights,
} from '@moltnet/tasks';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

import {
  GateExpectations,
  GIT_SEED_PROMPT_PLACEHOLDERS,
  type ResolvedScenarioFixtures,
  type Scenario,
  SCENARIO_TASK_TYPES,
  ScenarioFixtureConfig,
  type ScenarioInputArtifactFixture,
  type ScenarioTaskType,
} from './scenario.js';
import { formatTypeBoxErrors } from './typebox-errors.js';

/** Thrown when a scenario directory does not conform to the format. */
export class ScenarioError extends Error {
  constructor(
    readonly slug: string,
    message: string,
  ) {
    super(`Scenario "${slug}": ${message}`);
    this.name = 'ScenarioError';
  }
}

function readText(dir: string, slug: string, file: string): string {
  try {
    return readFileSync(join(dir, file), 'utf8');
  } catch {
    throw new ScenarioError(slug, `missing or unreadable ${file}`);
  }
}

function readJson(dir: string, slug: string, file: string): unknown {
  const raw = readText(dir, slug, file);
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ScenarioError(
      slug,
      `${file} is not valid JSON: ${(err as Error).message}`,
    );
  }
}

/**
 * Validate `value` against a TypeBox schema, listing every error. The schema's
 * `$id` is used only for the message.
 */
function assertSchema(
  slug: string,
  file: string,
  schema: TSchema,
  value: unknown,
): void {
  if (Value.Check(schema, value)) {
    return;
  }
  const errors = formatTypeBoxErrors(schema, value);
  throw new ScenarioError(slug, `${file} failed schema validation: ${errors}`);
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..')
  );
}

function resolveFixturePath(
  dir: string,
  slug: string,
  fixturePath: string,
  expected: 'file' | 'directory',
): string {
  if (isAbsolute(fixturePath)) {
    throw new ScenarioError(
      slug,
      `eval.json fixture path "${fixturePath}" must be relative to the scenario directory`,
    );
  }

  const lexicalRoot = resolve(dir);
  const scenarioRoot = realpathSync(lexicalRoot);
  const lexicalPath = resolve(lexicalRoot, fixturePath);
  if (!isWithin(lexicalRoot, lexicalPath)) {
    throw new ScenarioError(
      slug,
      `eval.json fixture path "${fixturePath}" escapes the scenario directory`,
    );
  }

  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(lexicalPath);
  } catch {
    throw new ScenarioError(
      slug,
      `eval.json fixture path "${fixturePath}" is missing or unreadable`,
    );
  }
  if (!isWithin(scenarioRoot, resolvedPath)) {
    throw new ScenarioError(
      slug,
      `eval.json fixture path "${fixturePath}" resolves outside the scenario directory`,
    );
  }
  if (lstatSync(lexicalPath).isSymbolicLink()) {
    throw new ScenarioError(
      slug,
      `eval.json fixture path "${fixturePath}" must not be a symbolic link`,
    );
  }

  const stats = statSync(resolvedPath);
  if (
    (expected === 'file' && !stats.isFile()) ||
    (expected === 'directory' && !stats.isDirectory())
  ) {
    throw new ScenarioError(
      slug,
      `eval.json fixture path "${fixturePath}" must be a ${expected}`,
    );
  }
  return lexicalPath;
}

function assertSeedTreeIsContained(
  scenarioDir: string,
  slug: string,
  seedRoot: string,
  {
    label,
    rejectGitMetadata,
  }: { label: string; rejectGitMetadata: boolean } = {
    label: 'workspace seed',
    rejectGitMetadata: false,
  },
): void {
  const scenarioRoot = realpathSync(scenarioDir);
  for (const entry of readdirSync(seedRoot, { withFileTypes: true })) {
    const entryPath = join(seedRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw new ScenarioError(
        slug,
        `${label} contains symbolic link "${relative(scenarioDir, entryPath)}"`,
      );
    }
    if (rejectGitMetadata && entry.name === '.git') {
      throw new ScenarioError(
        slug,
        `${label} must not contain git metadata "${relative(scenarioDir, entryPath)}"`,
      );
    }
    const resolvedEntry = realpathSync(entryPath);
    if (!isWithin(scenarioRoot, resolvedEntry)) {
      throw new ScenarioError(
        slug,
        `${label} entry "${relative(scenarioDir, entryPath)}" resolves outside the scenario directory`,
      );
    }
    if (entry.isDirectory()) {
      assertSeedTreeIsContained(scenarioDir, slug, entryPath, {
        label,
        rejectGitMetadata,
      });
    } else if (!entry.isFile()) {
      throw new ScenarioError(
        slug,
        `${label} entry "${relative(scenarioDir, entryPath)}" is not a regular file or directory`,
      );
    }
  }
}

function defaultContentType(path: string): string {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  switch (extension) {
    case '.json':
      return 'application/json';
    case '.md':
      return 'text/markdown';
    case '.txt':
      return 'text/plain';
    case '.yaml':
    case '.yml':
      return 'application/yaml';
    default:
      return 'application/octet-stream';
  }
}

function resolveGitSeed(
  dir: string,
  slug: string,
  gitSeed: NonNullable<ScenarioFixtureConfig['gitSeed']>,
): NonNullable<ResolvedScenarioFixtures['gitSeed']> {
  const scenarioRoot = realpathSync(dir);
  const [basePath, headPath] = (['base', 'head'] as const).map((side) => {
    const path = resolveFixturePath(dir, slug, gitSeed[side], 'directory');
    // The scenario root holds the hidden rubric and gates; it must never
    // become a committed tree the producer can read.
    if (realpathSync(path) === scenarioRoot) {
      throw new ScenarioError(
        slug,
        `eval.json gitSeed.${side} must be a subdirectory, not the scenario directory`,
      );
    }
    assertSeedTreeIsContained(dir, slug, path, {
      label: `gitSeed.${side}`,
      rejectGitMetadata: true,
    });
    return path;
  });
  if (realpathSync(basePath) === realpathSync(headPath)) {
    throw new ScenarioError(
      slug,
      'eval.json gitSeed.base and gitSeed.head must be different directories',
    );
  }
  return { basePath, headPath };
}

function resolveFixtures(
  dir: string,
  slug: string,
  config: ScenarioFixtureConfig | undefined,
  workspace: Scenario['execution']['workspace'],
  taskType: ScenarioTaskType,
): NonNullable<Scenario['fixtures']> {
  if (!config) {
    return { inputArtifacts: [] };
  }
  if (config.gitSeed && config.workspaceSeed) {
    throw new ScenarioError(
      slug,
      'eval.json gitSeed and workspaceSeed are mutually exclusive',
    );
  }
  if (config.workspaceSeed && workspace !== 'shared_mount') {
    throw new ScenarioError(
      slug,
      'eval.json workspaceSeed requires workspace "shared_mount"',
    );
  }
  if (config.gitSeed) {
    if (taskType !== 'freeform') {
      throw new ScenarioError(
        slug,
        'eval.json gitSeed requires taskType "freeform" (run_eval cannot pin a revision)',
      );
    }
    if (workspace !== 'dedicated_worktree') {
      throw new ScenarioError(
        slug,
        'eval.json gitSeed requires workspace "dedicated_worktree"',
      );
    }
  }

  const workspaceSeedPath = config.workspaceSeed
    ? resolveFixturePath(dir, slug, config.workspaceSeed, 'directory')
    : undefined;
  if (workspaceSeedPath) {
    assertSeedTreeIsContained(dir, slug, workspaceSeedPath);
  }
  const gitSeed = config.gitSeed
    ? resolveGitSeed(dir, slug, config.gitSeed)
    : undefined;

  const inputArtifacts = (config.inputArtifacts ?? []).map(
    (fixture: ScenarioInputArtifactFixture) => {
      const sourcePath = resolveFixturePath(dir, slug, fixture.path, 'file');
      return {
        ...fixture,
        sourcePath,
        role: fixture.role ?? 'context',
        kind: fixture.kind ?? 'eval-input',
        title: fixture.title ?? basename(fixture.path),
        contentType: fixture.contentType ?? defaultContentType(fixture.path),
      };
    },
  );

  return { workspaceSeedPath, gitSeed, inputArtifacts };
}

const GIT_SEED_PLACEHOLDER = /\{\{\s*gitSeed\.[^}]*\}\}/g;
const SUPPORTED_GIT_SEED_PLACEHOLDERS: ReadonlySet<string> = new Set(
  Object.values(GIT_SEED_PROMPT_PLACEHOLDERS),
);

/**
 * `{{gitSeed.base}}` / `{{gitSeed.head}}` are substituted at task creation.
 * Reject them without a gitSeed, and reject unknown keys, so a typo never
 * reaches the producer as literal braces.
 */
function assertGitSeedPlaceholders(
  slug: string,
  prompt: string,
  hasGitSeed: boolean,
): void {
  for (const match of prompt.matchAll(GIT_SEED_PLACEHOLDER)) {
    if (!hasGitSeed) {
      throw new ScenarioError(
        slug,
        `prompt.md uses ${match[0]} but eval.json declares no gitSeed fixture`,
      );
    }
    if (!SUPPORTED_GIT_SEED_PLACEHOLDERS.has(match[0])) {
      throw new ScenarioError(
        slug,
        `prompt.md placeholder ${match[0]} is not supported (expected ${[...SUPPORTED_GIT_SEED_PLACEHOLDERS].join(' or ')})`,
      );
    }
  }
}

/**
 * Read and validate a single scenario directory. `dir` is the absolute path to
 * `evals-v2/<slug>/`; the slug is derived from the directory's basename.
 *
 * @throws {ScenarioError} on any missing file, malformed JSON, schema
 *   violation, or a rubric whose weights do not sum to 1.
 */
export function readScenario(dir: string): Scenario {
  const slug = basename(dir);

  const prompt = readText(dir, slug, 'prompt.md').trim();
  if (prompt.length === 0) {
    throw new ScenarioError(slug, 'prompt.md is empty');
  }

  // Split harness-only fields out before validating the execution shape,
  // which is `additionalProperties: false`.
  const evalJson = readJson(dir, slug, 'eval.json');
  if (
    typeof evalJson !== 'object' ||
    evalJson === null ||
    Array.isArray(evalJson)
  ) {
    throw new ScenarioError(slug, 'eval.json must be a JSON object');
  }
  const {
    taskType: rawTaskType,
    contextRecipe: rawContextRecipe,
    fixtures: rawFixtures,
    outputContract: rawOutputContract,
    scoring: rawScoring,
    blocking: rawBlocking,
    ...execution
  } = evalJson as Record<string, unknown>;
  if (rawBlocking !== undefined && typeof rawBlocking !== 'boolean') {
    throw new ScenarioError(slug, 'eval.json blocking must be a boolean');
  }
  const scoring = rawScoring ?? 'judge';
  if (scoring !== 'judge' && scoring !== 'gates_only') {
    throw new ScenarioError(
      slug,
      'eval.json scoring must be judge or gates_only',
    );
  }
  const taskType = rawTaskType ?? 'run_eval';
  if (!SCENARIO_TASK_TYPES.includes(taskType as ScenarioTaskType)) {
    throw new ScenarioError(
      slug,
      `eval.json taskType "${String(rawTaskType)}" is not supported (expected one of: ${SCENARIO_TASK_TYPES.join(', ')})`,
    );
  }
  if (
    rawContextRecipe !== undefined &&
    (typeof rawContextRecipe !== 'string' ||
      !runtimeProfileContextRecipeIds.includes(rawContextRecipe))
  ) {
    throw new ScenarioError(
      slug,
      `eval.json contextRecipe ${JSON.stringify(rawContextRecipe)} is not supported (expected one of: ${runtimeProfileContextRecipeIds.join(', ')})`,
    );
  }
  if (rawContextRecipe !== undefined && taskType === 'freeform') {
    throw new ScenarioError(
      slug,
      'eval.json contextRecipe is only supported for run_eval scenarios',
    );
  }
  if (rawOutputContract !== undefined) {
    if (taskType !== 'freeform') {
      throw new ScenarioError(
        slug,
        'eval.json outputContract requires freeform taskType',
      );
    }
    const errors = validateOutputContract('freeform', {
      outputContract: rawOutputContract,
    });
    if (errors.length > 0) {
      throw new ScenarioError(
        slug,
        `eval.json outputContract: ${errors[0].message}`,
      );
    }
  }
  assertSchema(slug, 'eval.json', RunEvalExecution, execution);
  if (rawFixtures !== undefined) {
    assertSchema(
      slug,
      'eval.json fixtures',
      ScenarioFixtureConfig,
      rawFixtures,
    );
  }
  const fixtures = resolveFixtures(
    dir,
    slug,
    rawFixtures as ScenarioFixtureConfig | undefined,
    (execution as Scenario['execution']).workspace,
    taskType as ScenarioTaskType,
  );
  assertGitSeedPlaceholders(slug, prompt, fixtures.gitSeed !== undefined);

  let rubric: Scenario['rubric'];
  if (scoring === 'judge') {
    const parsed = readJson(dir, slug, 'rubric.json');
    assertSchema(slug, 'rubric.json', Rubric, parsed);
    rubric = parsed as NonNullable<Scenario['rubric']>;
    const weightError = validateRubricWeights(rubric);
    if (weightError !== null) {
      throw new ScenarioError(slug, `rubric.json ${weightError}`);
    }
  } else if (rawOutputContract === undefined) {
    throw new ScenarioError(
      slug,
      'eval.json gates_only requires outputContract',
    );
  } else if (existsSync(join(dir, 'rubric.json'))) {
    throw new ScenarioError(
      slug,
      'rubric.json is not used by gates_only scoring',
    );
  }

  const gates = readJson(dir, slug, 'gates.json');
  assertSchema(slug, 'gates.json', GateExpectations, gates);
  if (
    scoring === 'gates_only' &&
    (gates as Scenario['gates']).requireCleanSubmit !== true
  ) {
    throw new ScenarioError(
      slug,
      'gates.json gate-only scoring requires requireCleanSubmit: true',
    );
  }

  return {
    slug,
    taskType: taskType as Scenario['taskType'],
    scoring,
    blocking: rawBlocking ?? true,
    outputContract: rawOutputContract as Scenario['outputContract'],
    contextRecipe: rawContextRecipe,
    prompt,
    execution: execution as Scenario['execution'],
    fixtures,
    rubric,
    gates: gates as Scenario['gates'],
  };
}
