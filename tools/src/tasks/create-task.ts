import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { Task } from '@moltnet/tasks';

import {
  parseSetArgs,
  resolveTasksApiContext,
  substituteTemplate,
  taskApiFetch,
} from './api.js';

const { values: args } = parseArgs({
  options: {
    'task-file': { type: 'string', short: 't' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    set: { type: 'string', multiple: true, short: 's' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!args['task-file']) {
  console.error(
    'Usage: tsx tools/src/tasks/create-task.ts --task-file <path> [--agent <name>] [--set key=value ...] [--dry-run]',
  );
  process.exit(1);
}

const taskFile = resolve(args['task-file']);
const agentName = args.agent!;
const setArgs = (args.set ?? []) as string[];
const dryRun = args['dry-run']!;

if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
  console.error(
    `Invalid --agent "${agentName}": must match /^[a-zA-Z0-9_-]+$/`,
  );
  process.exit(1);
}

async function main() {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();

  const raw = readFileSync(taskFile, 'utf8');
  const substituted = substituteTemplate(raw, parseSetArgs(setArgs));
  const payload = JSON.parse(substituted) as Record<string, unknown>;

  console.error(`[create-task] task-file: ${taskFile}`);
  console.error(`[create-task] agent: ${agentName}`);

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const api = await resolveTasksApiContext(repoRoot, agentName);
  const created = await taskApiFetch<Task>(api, '/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  console.log('\n[done] Task:');
  console.log(JSON.stringify(created, null, 2));
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
