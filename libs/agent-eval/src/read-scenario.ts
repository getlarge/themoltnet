/**
 * Reader for `evals-v2/<slug>/` scenario directories. Fails loudly on any
 * drift — a missing file, malformed JSON, a schema violation, or a rubric
 * whose weights do not sum to 1. This is the deliberate opposite of the
 * orphaned `tools/src/tasks/scenario.ts`, which silently dropped fields.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  Rubric,
  RunEvalExecution,
  validateRubricWeights,
} from '@moltnet/tasks';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

import { GateExpectations, type Scenario } from './scenario.js';

/** Shape of a typebox v1 validation error we read fields off of. */
interface TypeBoxError {
  instancePath: string;
  message: string;
}

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
  const errors = [...Value.Errors(schema, value)]
    .map((raw) => {
      const e = raw as unknown as TypeBoxError;
      return `${e.instancePath || '/'}: ${e.message}`;
    })
    .join('; ');
  throw new ScenarioError(slug, `${file} failed schema validation: ${errors}`);
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

  const execution = readJson(dir, slug, 'eval.json');
  assertSchema(slug, 'eval.json', RunEvalExecution, execution);

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
    prompt,
    execution: execution as Scenario['execution'],
    rubric: rubric as Scenario['rubric'],
    gates: gates as Scenario['gates'],
  };
}
