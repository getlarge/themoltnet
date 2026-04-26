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
import { isHelpFlag, ONCE_HELP } from '../lib/help.js';
import {
  commonOptionDefs,
  type CommonOptions,
  MissingRequiredOptionError,
  parseCommonOptions,
} from '../lib/options.js';
import { initWorkerOtel } from '../lib/otel.js';
import { resolveSandbox } from '../lib/sandbox.js';

export async function runOnce(argv: string[]): Promise<number> {
  if (isHelpFlag(argv)) {
    console.log(ONCE_HELP);
    return 0;
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      ...commonOptionDefs(),
      'task-id': { type: 'string', short: 't' },
      sandbox: { type: 'string' },
    },
  });

  if (!values['task-id']) {
    console.error('Missing required flag: --task-id\n');
    console.error(ONCE_HELP);
    return 1;
  }

  const taskId = values['task-id'];
  let opts: CommonOptions;
  try {
    opts = parseCommonOptions(values);
  } catch (err) {
    if (err instanceof MissingRequiredOptionError) {
      console.error(`${err.message}\n`);
      console.error(ONCE_HELP);
      return 1;
    }
    throw err;
  }
  const sandbox = resolveSandbox(process.cwd(), values.sandbox);
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

  console.error(`[once] sandbox=${sandbox.path}`);
  console.error(
    `[once] task=${taskId} agent=${opts.agent} provider=${opts.provider} model=${opts.model}`,
  );

  try {
    const executeTask = createPiTaskExecutor({
      agentName: opts.agent,
      mountPath: sandbox.rootDir,
      provider: opts.provider,
      model: opts.model,
      sandboxConfig: sandbox.config,
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
