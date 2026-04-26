/**
 * `agent-daemon once --task-id <uuid>` — claim and execute one specific
 * queued task by id, then exit. Replaces the standalone `work-task` script.
 */
import { parseArgs } from 'node:util';

import {
  AgentRuntime,
  ApiTaskReporter,
  ApiTaskSource,
} from '@themoltnet/agent-runtime';
import { createPiTaskExecutor } from '@themoltnet/pi-extension';

import { loadConfig } from '../config.js';
import { resolveAgentContext } from '../lib/agent-context.js';
import { finalizeTask } from '../lib/finalize.js';
import { commonOptionDefs, parseCommonOptions } from '../lib/options.js';
import { initWorkerOtel } from '../lib/otel.js';
import { loadSandboxConfig } from '../lib/sandbox.js';

export async function runOnce(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      ...commonOptionDefs(),
      'task-id': { type: 'string', short: 't' },
    },
  });

  if (!values['task-id']) {
    console.error(
      'Usage: agent-daemon once --task-id <uuid> [--agent <name>] ...',
    );
    return 1;
  }

  const taskId = values['task-id'];
  const opts = parseCommonOptions(values);
  const cwd = process.cwd();
  const sandboxConfig = loadSandboxConfig(cwd);
  const ctx = await resolveAgentContext(opts.agent);

  const cfg = loadConfig();
  const otelShutdown = await initWorkerOtel({
    serviceName: 'moltnet.agent-daemon.once',
    agentDir: ctx.agentDir,
    endpoint: cfg.otelEndpoint,
    resourceAttributes: {
      'moltnet.task.id': taskId,
      'moltnet.agent.name': opts.agent,
      'moltnet.llm.provider': opts.provider,
      'moltnet.llm.model': opts.model,
    },
  });

  console.error(
    `[once] task=${taskId} agent=${opts.agent} provider=${opts.provider} model=${opts.model}`,
  );

  try {
    const executeTask = createPiTaskExecutor({
      agentName: opts.agent,
      mountPath: cwd,
      provider: opts.provider,
      model: opts.model,
      sandboxConfig,
    });

    const runtime = new AgentRuntime({
      source: new ApiTaskSource({
        agent: ctx.agent,
        taskId,
        leaseTtlSec: opts.leaseTtlSec,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: ctx.agent.tasks,
          leaseTtlSec: opts.leaseTtlSec,
          heartbeatIntervalMs: opts.heartbeatIntervalMs,
          maxBatchSize: opts.maxBatchSize,
          flushIntervalMs: opts.flushIntervalMs,
        }),
      executeTask,
    });

    const outputs = await runtime.start();
    const [output] = outputs;
    if (!output) {
      console.error('[once] runtime produced no outputs');
      return 1;
    }
    await finalizeTask(ctx.agent, output);
    console.log('\n[done] TaskOutput:');
    console.log(JSON.stringify(output, null, 2));
    return output.status === 'completed' ? 0 : 1;
  } finally {
    await otelShutdown();
  }
}
