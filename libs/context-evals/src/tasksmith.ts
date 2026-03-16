import { access, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import type { GpackTask } from './evaluate.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

const NonEmptyString = Type.String({ minLength: 1 });
const NonEmptyStringArray = Type.Array(NonEmptyString);

export const TasksmithTaskSchema = Type.Object({
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

export type TasksmithTask = Static<typeof TasksmithTaskSchema>;

// ── Shared interface ──────────────────────────────────────────────────────────

export interface EvalInput {
  name: string;
  task: GpackTask;
  taskPrompt: string;
}

// ── Validation ────────────────────────────────────────────────────────────────

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
  throw new Error(`[tasksmith] ${evalName}: ${path} ${message}`);
}

export function validateTasksmithTask(
  taskName: string,
  task: unknown,
): asserts task is TasksmithTask {
  if (!Value.Check(TasksmithTaskSchema, task)) {
    formatTypeboxErrors(TasksmithTaskSchema, taskName, task);
  }
}

// ── Conversion ────────────────────────────────────────────────────────────────

export function tasksmithToGpackTask(raw: TasksmithTask): GpackTask {
  return {
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
}

// ── Loaders ───────────────────────────────────────────────────────────────────

export interface LoadTasksmithInputsOptions {
  taskStatus?: string;
  familyFilter?: Set<string>;
}

export async function loadTasksmithInputs(
  repoRoot: string,
  spec: string,
  options: LoadTasksmithInputsOptions = {},
): Promise<EvalInput[]> {
  const { taskStatus = 'verified', familyFilter = new Set<string>() } = options;
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

    inputs.push({
      name: raw.task_id,
      task: tasksmithToGpackTask(raw),
      taskPrompt: raw.problem_statement,
    });
  }

  return inputs;
}

export async function loadTasksmithTaskFile(
  repoRoot: string,
  taskFile: string,
): Promise<EvalInput> {
  const resolvedPath = resolve(repoRoot, taskFile);
  const raw = JSON.parse(await readFile(resolvedPath, 'utf8')) as unknown;
  const taskName =
    resolvedPath
      .split('/')
      .at(-1)
      ?.replace(/\.json$/, '') ?? taskFile;
  validateTasksmithTask(taskName, raw);

  return {
    name: raw.task_id,
    task: tasksmithToGpackTask(raw),
    taskPrompt: raw.problem_statement,
  };
}
