/**
 * run-task.ts — execute a Task from a JSON fixture via the agent-runtime.
 *
 * Usage:
 *   pnpm --filter @moltnet/tools task:run --task-file demo/tasks/hello-world.json
 *   pnpm exec tsx tools/src/tasks/run-task.ts --task-file demo/tasks/hello-world.json
 *   pnpm exec tsx tools/src/tasks/run-task.ts --task-file <path> --agent legreffier \
 *     --provider openai --model gpt-5.3-codex
 *
 * Related
 * -------
 *   tools/src/tasks/fulfill-brief.ts — GitHub-issue shim that synthesizes a
 *                                       fulfill_brief Task and runs it.
 *   demo/tasks/*.json                — minimal Task fixtures for smoke tests.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  AgentRuntime,
  FileTaskSource,
  StdoutReporter,
} from '@moltnet/agent-runtime';
import type { SandboxConfig } from '@themoltnet/pi-extension';
import { createPiTaskExecutor } from '@themoltnet/pi-extension/runtime';

const { values: args } = parseArgs({
  options: {
    'task-file': { type: 'string', short: 't' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    model: { type: 'string', short: 'm', default: 'gpt-5.3-codex' },
    provider: { type: 'string', short: 'p', default: 'openai' },
  },
});

if (!args['task-file']) {
  console.error(
    'Usage: tsx tools/src/tasks/run-task.ts --task-file <path> [--agent <name>] [--provider <p>] [--model <id>]',
  );
  process.exit(1);
}

const taskFile = resolve(args['task-file']);
const agentName = args.agent!;
const modelId = args.model!;
const provider = args.provider!;

if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
  console.error(
    `Invalid --agent "${agentName}": must match /^[a-zA-Z0-9_-]+$/`,
  );
  process.exit(1);
}

async function main() {
  const cwd = process.cwd();
  const sandboxConfig = JSON.parse(
    readFileSync(join(cwd, 'sandbox.json'), 'utf8'),
  ) as SandboxConfig;

  const mainRepo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const agentDir = join(mainRepo, '.moltnet', agentName);

  console.error(`[run-task] task-file: ${taskFile}`);
  console.error(
    `[run-task] agent: ${agentName}, provider: ${provider}, model: ${modelId}`,
  );
  console.error(`[run-task] agentDir: ${agentDir}`);

  const executeTask = createPiTaskExecutor({
    agentName,
    mountPath: cwd,
    provider,
    model: modelId,
    sandboxConfig,
  });

  const runtime = new AgentRuntime({
    source: new FileTaskSource(taskFile),
    makeReporter: () => new StdoutReporter(),
    executeTask,
  });

  const outputs = await runtime.start();
  const [output] = outputs;
  if (!output) {
    console.error('[fatal] Runtime produced no outputs');
    process.exit(1);
  }

  console.log('\n[done] TaskOutput:');
  console.log(JSON.stringify(output, null, 2));
  if (output.status !== 'completed') process.exit(1);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
