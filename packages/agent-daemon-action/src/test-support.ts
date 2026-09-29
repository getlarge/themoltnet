/**
 * Shared harness for tests that run action.yml shell steps with bash against
 * fake binaries.
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

export interface ActionStep {
  id?: string;
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
}

export interface CompositeAction {
  inputs: Record<string, { default?: string; required?: boolean }>;
  runs: { steps: ActionStep[] };
}

export const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

export function loadAction(): CompositeAction {
  return parse(
    readFileSync(resolve(packageRoot, 'action.yml'), 'utf8'),
  ) as CompositeAction;
}

export function stepById(
  action: CompositeAction,
  id: string,
): ActionStep & { run: string } {
  const step = action.runs.steps.find((candidate) => candidate.id === id);
  if (!step?.run) throw new Error(`Missing action step id: ${id}`);
  return step as ActionStep & { run: string };
}

/**
 * Inlines the `${{ }}` expressions the runner would resolve. An expression
 * without a value fails the test instead of reaching bash unrendered.
 */
export function renderRun(
  run: string,
  expressions: Record<string, string> = {},
): string {
  return run.replace(
    /\$\{\{\s*([^}]+?)\s*\}\}/g,
    (_match, expression: string) => {
      if (!(expression in expressions)) {
        throw new Error(`Unrendered expression in step: \${{ ${expression} }}`);
      }
      return expressions[expression];
    },
  );
}

export function writeExecutable(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`, 'utf8');
  chmodSync(path, 0o755);
}

/** Lines of a call log, or none when nothing was called. */
export function readCalls(path: string): string[] {
  try {
    return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
