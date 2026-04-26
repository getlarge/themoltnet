// Shared poll-loop runner for `poll` and `drain` (only difference: stopWhenEmpty).
import { parseArgs } from 'node:util';

import type { TaskOutput } from '@moltnet/tasks';
import {
  AgentRuntime,
  ApiTaskReporter,
  PollingApiTaskSource,
} from '@themoltnet/agent-runtime';
import { createPiTaskExecutor } from '@themoltnet/pi-extension';

import { loadConfig } from '../config.js';
import { resolveAgentContext } from '../lib/agent-context.js';
import { finalizeTask } from '../lib/finalize.js';
import { isHelpFlag } from '../lib/help.js';
import {
  commonOptionDefs,
  type CommonOptions,
  MissingRequiredOptionError,
  parseCommonOptions,
  validateTaskTypes,
} from '../lib/options.js';
import { initWorkerOtel } from '../lib/otel.js';
import { loadSandboxConfig } from '../lib/sandbox.js';

export interface PollSharedArgs {
  argv: string[];
  serviceName: string;
  stopWhenEmpty: boolean;
  modeLabel: string;
  helpText: string;
}

export async function runPolling(opts: PollSharedArgs): Promise<number> {
  if (isHelpFlag(opts.argv)) {
    console.log(opts.helpText);
    return 0;
  }

  const { values } = parseArgs({
    args: opts.argv,
    options: {
      ...commonOptionDefs(),
      team: { type: 'string' },
      'task-types': { type: 'string' },
      'diary-ids': { type: 'string' },
      'poll-interval-ms': { type: 'string' },
      'max-poll-interval-ms': { type: 'string' },
      'list-limit': { type: 'string' },
    },
  });

  if (!values.team) {
    console.error('Missing required flag: --team\n');
    console.error(opts.helpText);
    return 1;
  }

  const teamId = values.team;
  let taskTypes: string[];
  try {
    taskTypes = validateTaskTypes(parseCsv(values['task-types']));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    return 1;
  }
  const diaryIds = parseCsv(values['diary-ids']);
  let common: CommonOptions;
  try {
    common = parseCommonOptions(values);
  } catch (err) {
    if (err instanceof MissingRequiredOptionError) {
      console.error(`${err.message}\n`);
      console.error(opts.helpText);
      return 1;
    }
    throw err;
  }
  const pollIntervalMs = optionalPositiveInt(
    values['poll-interval-ms'],
    'poll-interval-ms',
    2_000,
  );
  const maxPollIntervalMs = optionalPositiveInt(
    values['max-poll-interval-ms'],
    'max-poll-interval-ms',
    30_000,
  );
  const listLimit = optionalPositiveInt(values['list-limit'], 'list-limit', 10);

  if (taskTypes.length === 0) {
    console.error(
      `[${opts.modeLabel}] --task-types is empty — daemon will accept any registered type. ` +
        'Pass an explicit list to limit scope (e.g. --task-types fulfill_brief).',
    );
  }

  const cwd = process.cwd();
  const sandboxConfig = loadSandboxConfig(cwd);
  const ctx = await resolveAgentContext(common.agent);

  const cfg = loadConfig();
  const otelShutdown = await initWorkerOtel({
    serviceName: opts.serviceName,
    agentDir: ctx.agentDir,
    endpoint: cfg.otelEndpoint,
    resourceAttributes: {
      'moltnet.team.id': teamId,
      'moltnet.agent.name': common.agent,
      'moltnet.llm.provider': common.provider,
      'moltnet.llm.model': common.model,
    },
  });

  const abort = new AbortController();
  let runtime: AgentRuntime | null = null;
  const onSignal = (sig: string) => {
    console.error(`[${opts.modeLabel}] received ${sig}, draining…`);
    abort.abort();
    runtime?.stop();
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  console.error(
    `[${opts.modeLabel}] team=${teamId} types=[${taskTypes.join(',') || '*'}] ` +
      `diaries=[${diaryIds.join(',') || '*'}] agent=${common.agent} ` +
      `provider=${common.provider} model=${common.model}`,
  );
  console.error(
    `[${opts.modeLabel}] lease=${common.leaseTtlSec}s heartbeat=${common.heartbeatIntervalMs}ms ` +
      `poll=${pollIntervalMs}-${maxPollIntervalMs}ms`,
  );

  const outputs: TaskOutput[] = [];
  try {
    const executeTask = createPiTaskExecutor({
      agentName: common.agent,
      mountPath: cwd,
      provider: common.provider,
      model: common.model,
      sandboxConfig,
    });

    runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent: ctx.agent,
        teamId,
        taskTypes: taskTypes.length > 0 ? taskTypes : undefined,
        diaryIds: diaryIds.length > 0 ? diaryIds : undefined,
        leaseTtlSec: common.leaseTtlSec,
        listLimit,
        pollIntervalMs,
        maxPollIntervalMs,
        signal: abort.signal,
        stopWhenEmpty: opts.stopWhenEmpty,
        log: (msg, meta) =>
          console.error(`[${opts.modeLabel}] ${msg}`, meta ?? {}),
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: ctx.agent.tasks,
          leaseTtlSec: common.leaseTtlSec,
          heartbeatIntervalMs: common.heartbeatIntervalMs,
          maxBatchSize: common.maxBatchSize,
          flushIntervalMs: common.flushIntervalMs,
        }),
      executeTask: async (claimedTask, reporter) => {
        // Belt-and-braces: refuse a task whose type isn't in the configured
        // whitelist (e.g. server filter race after config change). The
        // task requeues for someone else.
        if (
          taskTypes.length > 0 &&
          !taskTypes.includes(claimedTask.task.taskType)
        ) {
          return {
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
            status: 'failed',
            output: null,
            outputCid: null,
            usage: { inputTokens: 0, outputTokens: 0 },
            durationMs: 0,
            error: {
              code: 'unsupported_task_type',
              message:
                `Daemon does not support task type "${claimedTask.task.taskType}". ` +
                `Configured types: ${taskTypes.join(', ')}.`,
              retryable: true,
            },
          };
        }
        // Pre-execute cancel check. The reporter's first heartbeat
        // (fired by `open()`) may already have observed `cancelled:true`
        // from the server — e.g. the imposer cancelled between claim and
        // executor entry. Don't burn a VM on work that's already
        // terminal. The runtime would override our output anyway via the
        // post-execute cancelSignal check, but bailing here saves the
        // VM resume.
        if (reporter.cancelSignal.aborted) {
          return {
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
            status: 'cancelled',
            output: null,
            outputCid: null,
            usage: { inputTokens: 0, outputTokens: 0 },
            durationMs: 0,
            error: {
              code: 'task_cancelled',
              message:
                reporter.cancelReason ??
                'Task cancelled before executor started.',
              retryable: false,
            },
          };
        }
        return executeTask(claimedTask, reporter);
      },
    });

    const drained = await runtime.start();
    outputs.push(...drained);
    for (const output of drained) {
      await finalizeTask(ctx.agent, output);
    }
    console.error(
      `[${opts.modeLabel}] drained, ${drained.length} task(s) processed`,
    );
    const anyFailed = drained.some((o) => o.status !== 'completed');
    return anyFailed ? 1 : 0;
  } finally {
    await otelShutdown();
  }
}

function parseCsv(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function optionalPositiveInt(
  raw: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (raw === undefined) return defaultValue;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) {
    throw new Error(`Invalid --${name} "${raw}": must be a positive integer`);
  }
  return v;
}
