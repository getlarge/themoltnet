/**
 * Reader for `evals-v2/<slug>/` scenario directories. Fails loudly on any
 * drift — a missing file, malformed JSON, a schema violation, or a rubric
 * whose weights do not sum to 1. This is the deliberate opposite of the
 * orphaned `tools/src/tasks/scenario.ts`, which silently dropped fields.
 */
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  Rubric,
  RunEvalExecution,
  validateRubricWeights,
} from '@moltnet/tasks';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

import {
  GateExpectations,
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
): void {
  const scenarioRoot = realpathSync(scenarioDir);
  for (const entry of readdirSync(seedRoot, { withFileTypes: true })) {
    const entryPath = join(seedRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw new ScenarioError(
        slug,
        `workspace seed contains symbolic link "${relative(scenarioDir, entryPath)}"`,
      );
    }
    const resolvedEntry = realpathSync(entryPath);
    if (!isWithin(scenarioRoot, resolvedEntry)) {
      throw new ScenarioError(
        slug,
        `workspace seed entry "${relative(scenarioDir, entryPath)}" resolves outside the scenario directory`,
      );
    }
    if (entry.isDirectory()) {
      assertSeedTreeIsContained(scenarioDir, slug, entryPath);
    } else if (!entry.isFile()) {
      throw new ScenarioError(
        slug,
        `workspace seed entry "${relative(scenarioDir, entryPath)}" is not a regular file or directory`,
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

function resolveFixtures(
  dir: string,
  slug: string,
  config: ScenarioFixtureConfig | undefined,
  workspace: Scenario['execution']['workspace'],
): NonNullable<Scenario['fixtures']> {
  if (!config) {
    return { inputArtifacts: [] };
  }
  if (config.workspaceSeed && workspace !== 'shared_mount') {
    throw new ScenarioError(
      slug,
      'eval.json workspaceSeed requires workspace "shared_mount"',
    );
  }

  const workspaceSeedPath = config.workspaceSeed
    ? resolveFixturePath(dir, slug, config.workspaceSeed, 'directory')
    : undefined;
  if (workspaceSeedPath) {
    assertSeedTreeIsContained(dir, slug, workspaceSeedPath);
  }

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

  return { workspaceSeedPath, inputArtifacts };
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
    fixtures: rawFixtures,
    ...execution
  } = evalJson as Record<string, unknown>;
  const taskType = rawTaskType ?? 'run_eval';
  if (!SCENARIO_TASK_TYPES.includes(taskType as ScenarioTaskType)) {
    throw new ScenarioError(
      slug,
      `eval.json taskType "${String(rawTaskType)}" is not supported (expected one of: ${SCENARIO_TASK_TYPES.join(', ')})`,
    );
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
  );

  const rubric = readJson(dir, slug, 'rubric.json');
  assertSchema(slug, 'rubric.json', Rubric, rubric);
  const weightError = validateRubricWeights(rubric as Scenario['rubric']);
  if (weightError !== null) {
    throw new ScenarioError(slug, `rubric.json ${weightError}`);
  }

  const gates = readJson(dir, slug, 'gates.json');
  assertSchema(slug, 'gates.json', GateExpectations, gates);

  return {
    slug,
    taskType: taskType as Scenario['taskType'],
    prompt,
    execution: execution as Scenario['execution'],
    fixtures,
    rubric: rubric as Scenario['rubric'],
    gates: gates as Scenario['gates'],
  };
}
