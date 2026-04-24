import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  AgentRuntime,
  ApiTaskReporter,
  ApiTaskSource,
  StdoutReporter,
} from '@themoltnet/agent-runtime';
import {
  createPiTaskExecutor,
  type SandboxConfig,
} from '@themoltnet/pi-extension';
import type { TasksNamespace } from '@themoltnet/sdk';

import { resolveTasksApiContext } from './api.js';
import { initWorkerOtel } from './otel-bootstrap.js';

const { values: args } = parseArgs({
  options: {
    'task-id': { type: 'string', short: 't' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    model: { type: 'string', short: 'm', default: 'gpt-5.3-codex' },
    provider: { type: 'string', short: 'p', default: 'openai-codex' },
    'lease-ttl-sec': { type: 'string', default: '300' },
    'heartbeat-interval-ms': { type: 'string', default: '60000' },
    'max-batch-size': { type: 'string', default: '50' },
    'flush-interval-ms': { type: 'string', default: '200' },
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
const maxBatchSize = Number(args['max-batch-size']);
const flushIntervalMs = Number(args['flush-interval-ms']);
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
if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
  console.error('Invalid --max-batch-size: must be a positive integer');
  process.exit(1);
}
if (!Number.isInteger(flushIntervalMs) || flushIntervalMs < 0) {
  console.error('Invalid --flush-interval-ms: must be a non-negative integer');
  process.exit(1);
}

async function main() {
  const cwd = process.cwd();
  const sandboxJsonPath = join(cwd, 'sandbox.json');
  let sandboxConfig: SandboxConfig;
  try {
    sandboxConfig = JSON.parse(readFileSync(sandboxJsonPath, 'utf8'));
  } catch (err) {
    const isEnoent =
      err instanceof Error && 'code' in err && err.code === 'ENOENT';
    throw new Error(
      isEnoent
        ? `sandbox.json not found at ${sandboxJsonPath}. Run work-task from the worktree root.`
        : `Failed to read sandbox.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const api = await resolveTasksApiContext(repoRoot, agentName);

  // Register the OTel SDK BEFORE runtime.start() so spans emitted by the
  // pi OTel extension (and any @opentelemetry/api calls in the runtime)
  // land on a real provider instead of the no-op tracer. Reads
  // MOLTNET_OTEL_ENDPOINT from env; if unset, the call is a no-op and
  // telemetry simply isn't exported — zero runtime cost.
  const otelShutdown = await initWorkerOtel({
    serviceName: 'moltnet.work-task',
    agentDir: api.agentDir,
    resourceAttributes: {
      'moltnet.task.id': taskId,
      'moltnet.agent.name': agentName,
      'moltnet.llm.provider': provider,
      'moltnet.llm.model': modelId,
    },
  });

  console.error(`[work-task] task-id: ${taskId}`);
  console.error(
    `[work-task] agent: ${agentName}, provider: ${provider}, model: ${modelId}`,
  );

  try {
    const executeTask = createPiTaskExecutor({
      agentName,
      mountPath: cwd,
      provider,
      model: modelId,
      sandboxConfig,
    });

    const runtime = new AgentRuntime({
      source: new ApiTaskSource({
        agent: api.agent,
        taskId,
        leaseTtlSec,
      }),
      makeReporter: () =>
        stdoutReporter
          ? new StdoutReporter()
          : new ApiTaskReporter({
              tasks: api.agent.tasks,
              leaseTtlSec,
              heartbeatIntervalMs,
              maxBatchSize,
              flushIntervalMs,
            }),
      executeTask,
    });

    const outputs = await runtime.start();
    const [output] = outputs;
    if (!output) {
      throw new Error('Runtime produced no outputs');
    }

    if (output.status === 'completed' && output.output && output.outputCid) {
      await api.agent.tasks.complete(taskId, output.attemptN, {
        output: output.output,
        outputCid: output.outputCid,
        usage: output.usage,
        ...(output.contentSignature
          ? { contentSignature: output.contentSignature }
          : {}),
      });
    } else {
      const error: NonNullable<Parameters<TasksNamespace['fail']>[2]>['error'] =
        output.error ?? {
          code:
            output.status === 'cancelled' ? 'task_cancelled' : 'task_failed',
          message:
            output.status === 'cancelled'
              ? 'Task was cancelled by the runtime.'
              : 'Task execution failed before producing a valid output.',
          retryable: false,
        };
      await api.agent.tasks.fail(taskId, output.attemptN, { error });
    }

    console.log('\n[done] TaskOutput:');
    console.log(JSON.stringify(output, null, 2));
    if (output.status !== 'completed') process.exit(1);
  } finally {
    // Drain pending span batches before the process exits so the final
    // span of the task (invoke_agent end, heartbeat errors, etc.) isn't
    // dropped on the floor when `process.exit()` runs.
    await otelShutdown();
  }
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
