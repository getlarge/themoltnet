import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  AgentRuntime,
  ApiTaskReporter,
  ApiTaskSource,
  StdoutReporter,
} from '@moltnet/agent-runtime';
import type { Task, TaskError } from '@moltnet/tasks';
import {
  createPiTaskExecutor,
  type SandboxConfig,
} from '@themoltnet/pi-extension';

import { resolveTasksApiContext, taskApiFetch } from './api.js';

const { values: args } = parseArgs({
  options: {
    'task-id': { type: 'string', short: 't' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    model: { type: 'string', short: 'm', default: 'gpt-5.3-codex' },
    provider: { type: 'string', short: 'p', default: 'openai-codex' },
    'lease-ttl-sec': { type: 'string', default: '300' },
    'heartbeat-interval-ms': { type: 'string', default: '60000' },
    'stdout-reporter': { type: 'boolean', default: false },
  },
});

if (!args['task-id']) {
  console.error(
    'Usage: tsx tools/src/tasks/work-task.ts --task-id <uuid> [--agent <name>] [--provider <p>] [--model <id>]',
  );
  process.exit(1);
}

const taskId = args['task-id'];
const agentName = args.agent!;
const modelId = args.model!;
const provider = args.provider!;
const leaseTtlSec = Number(args['lease-ttl-sec']);
const heartbeatIntervalMs = Number(args['heartbeat-interval-ms']);
const stdoutReporter = args['stdout-reporter']!;

if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
  console.error(
    `Invalid --agent "${agentName}": must match /^[a-zA-Z0-9_-]+$/`,
  );
  process.exit(1);
}
if (!Number.isFinite(leaseTtlSec) || leaseTtlSec < 1) {
  console.error('Invalid --lease-ttl-sec: must be a positive integer');
  process.exit(1);
}
if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs < 0) {
  console.error(
    'Invalid --heartbeat-interval-ms: must be a non-negative integer',
  );
  process.exit(1);
}

async function main() {
  const cwd = process.cwd();
  const sandboxConfig = JSON.parse(
    readFileSync(join(cwd, 'sandbox.json'), 'utf8'),
  ) as SandboxConfig;

  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const api = await resolveTasksApiContext(repoRoot, agentName);

  console.error(`[work-task] task-id: ${taskId}`);
  console.error(
    `[work-task] agent: ${agentName}, provider: ${provider}, model: ${modelId}`,
  );

  const executeTask = createPiTaskExecutor({
    agentName,
    mountPath: cwd,
    provider,
    model: modelId,
    sandboxConfig,
  });

  const runtime = new AgentRuntime({
    source: new ApiTaskSource({
      baseUrl: api.apiUrl,
      taskId,
      auth: api.auth,
      leaseTtlSec,
    }),
    makeReporter: () =>
      stdoutReporter
        ? new StdoutReporter()
        : new ApiTaskReporter({
            baseUrl: api.apiUrl,
            auth: api.auth,
            leaseTtlSec,
            heartbeatIntervalMs,
          }),
    executeTask,
  });

  const outputs = await runtime.start();
  const [output] = outputs;
  if (!output) {
    throw new Error('Runtime produced no outputs');
  }

  if (output.status === 'completed' && output.output && output.output_cid) {
    await taskApiFetch<Task>(api, `/tasks/${taskId}/attempts/${output.attempt_n}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        output: output.output,
        output_cid: output.output_cid,
        usage: output.usage,
        ...(output.content_signature
          ? { content_signature: output.content_signature }
          : {}),
      }),
    });
  } else {
    const error: TaskError = output.error ?? {
      code: output.status === 'cancelled' ? 'task_cancelled' : 'task_failed',
      message:
        output.status === 'cancelled'
          ? 'Task was cancelled by the runtime.'
          : 'Task execution failed before producing a valid output.',
      retryable: false,
    };
    await taskApiFetch<Task>(api, `/tasks/${taskId}/attempts/${output.attempt_n}/fail`, {
      method: 'POST',
      body: JSON.stringify({ error }),
    });
  }

  console.log('\n[done] TaskOutput:');
  console.log(JSON.stringify(output, null, 2));
  if (output.status !== 'completed') process.exit(1);
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
