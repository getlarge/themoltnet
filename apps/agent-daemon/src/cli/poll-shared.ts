// Shared poll-loop runner for `poll` and `drain` (only difference: stopWhenEmpty).
import { parseArgs } from 'node:util';

import type { TaskOutput } from '@moltnet/tasks';
import {
  AgentRuntime,
  ApiTaskReporter,
  type ClaimedTask,
  PollingApiTaskSource,
} from '@themoltnet/agent-runtime';
import {
  createPiTaskExecutor,
  findMainWorktree,
  resolveTaskWorktreePath,
} from '@themoltnet/pi-extension';

import { loadConfig } from '../config.js';
import { resolveAgentContext } from '../lib/agent-context.js';
import {
  createGhCliClient,
  makePrBodyAnchorWriter,
} from '../lib/correlation.js';
import {
  DaemonSlotRegistry,
  resolveLatestPiSessionPath,
} from '../lib/daemon-slot-registry.js';
import { finalizeTask } from '../lib/finalize.js';
import { isHelpFlag } from '../lib/help.js';
import { createRootLogger } from '../lib/logger.js';
import {
  commonOptionDefs,
  type CommonOptions,
  MissingRequiredOptionError,
  parseCommonOptions,
  validateTaskTypes,
} from '../lib/options.js';
import { initWorkerOtel } from '../lib/otel.js';
import { resolveSandbox } from '../lib/sandbox.js';
import { ensureDaemonStateDirs } from '../lib/state-dir.js';
import {
  buildDaemonTaskExecutionPlan,
  type DaemonSlotIdentity,
  type DaemonTaskExecutionPlan,
} from '../lib/task-execution-plan.js';
import { makeTurnEventHandlerFactory } from '../lib/turn-event-logger.js';

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
      sandbox: { type: 'string' },
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

  const sandbox = resolveSandbox(process.cwd(), values.sandbox);
  const stateDirs = ensureDaemonStateDirs(sandbox.rootDir);
  const slotRegistry = new DaemonSlotRegistry(stateDirs.registryDbPath);
  const slotIdentity: DaemonSlotIdentity = {
    agentName: common.agent,
    provider: common.provider,
    model: common.model,
  };
  const mainRepo = findMainWorktree();
  const executionPlans = new Map<string, DaemonTaskExecutionPlan>();
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

  const { logger, shutdown: shutdownLogger } = createRootLogger({
    name: `agent-daemon.${opts.modeLabel}`,
    level: cfg.logLevel || (common.debug ? 'debug' : 'info'),
  });
  const rootLogger = logger.child({
    mode: opts.modeLabel,
    agent: common.agent,
    teamId,
    provider: common.provider,
    model: common.model,
  });

  const abort = new AbortController();
  let runtime: AgentRuntime | null = null;
  const onSignal = (sig: string) => {
    rootLogger.warn({ signal: sig }, 'agent-daemon.draining');
    abort.abort();
    runtime?.stop();
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  rootLogger.info(
    {
      sandbox: sandbox.path,
      taskTypes: taskTypes.length > 0 ? taskTypes : ['*'],
      diaryIds: diaryIds.length > 0 ? diaryIds : ['*'],
      leaseTtlSec: common.leaseTtlSec,
      heartbeatIntervalMs: common.heartbeatIntervalMs,
      pollIntervalMs,
      maxPollIntervalMs,
    },
    'agent-daemon.starting',
  );

  const outputs: TaskOutput[] = [];
  try {
    const executeTask = createPiTaskExecutor({
      agentName: common.agent,
      mountPath: sandbox.rootDir,
      provider: common.provider,
      model: common.model,
      sandboxConfig: sandbox.config,
      makeExecutionPlan: (claimedTask) =>
        getOrCreateExecutionPlan(
          claimedTask,
          executionPlans,
          stateDirs,
          slotIdentity,
          common.warmSessionTtlSec,
        ),
      // Factory: pi-extension calls this once per task with the
      // claimed task; binds taskId+attemptN into the pino child so
      // turn events are correlatable per task in poll mode (#1078).
      makeOnTurnEvent: makeTurnEventHandlerFactory(rootLogger),
      maxTurns: common.maxTurns,
      maxBashTimeouts: common.maxBashTimeouts,
    });

    runtime = new AgentRuntime({
      logger: rootLogger,
      source: new PollingApiTaskSource({
        agent: ctx.agent,
        teamId,
        taskTypes: taskTypes.length > 0 ? taskTypes : undefined,
        provider: common.provider.toLowerCase(),
        model: common.model.toLowerCase(),
        diaryIds: diaryIds.length > 0 ? diaryIds : undefined,
        leaseTtlSec: common.leaseTtlSec,
        listLimit,
        pollIntervalMs,
        maxPollIntervalMs,
        signal: abort.signal,
        stopWhenEmpty: opts.stopWhenEmpty,
        debug: common.debug,
        logger: rootLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: ctx.agent.tasks,
          leaseTtlSec: common.leaseTtlSec,
          heartbeatIntervalMs: common.heartbeatIntervalMs,
          maxBatchSize: common.maxBatchSize,
          flushIntervalMs: common.flushIntervalMs,
        }),
      // Finalize each task as soon as the executor resolves — long-
      // polling sources never terminate, so deferring `/complete` to
      // after `runtime.start()` would let every lease expire even when
      // the judge submitted a clean payload. The post-drain finalize
      // loop that used to live below is gone: it would now double-
      // call `/complete` on every task and the server returns 409
      // "Task is already in terminal state" on the second call.
      onTaskFinished: (output, claimedTask) =>
        finalizeTask(ctx.agent, output, {
          task: claimedTask.task,
          writeCorrelationAnchors: makePrBodyAnchorWriter({
            gh: createGhCliClient(),
            logger: rootLogger,
          }),
          log: (msg, err) => rootLogger.warn({ err }, msg),
        }),
      executeTask: async (claimedTask, reporter) => {
        const executionPlan = getOrCreateExecutionPlan(
          claimedTask,
          executionPlans,
          stateDirs,
          slotIdentity,
          common.warmSessionTtlSec,
        );
        const sessionDescriptor = executionPlan.descriptor;
        const expired = slotRegistry.reapExpiredSlots();
        if (expired.length > 0) {
          rootLogger.info(
            {
              expiredCount: expired.length,
              slotKeys: expired.map((item) => item.slot.slotKey),
            },
            'agent-daemon.daemon_slots_reaped',
          );
        }
        rootLogger.debug(
          {
            taskId: claimedTask.task.id,
            taskType: claimedTask.task.taskType,
            resumable: sessionDescriptor.policy.resumable,
            workspaceMode: sessionDescriptor.policy.workspaceMode,
            workspaceScope: sessionDescriptor.policy.workspaceScope,
            sessionScope: sessionDescriptor.policy.sessionScope,
            slotKey: executionPlan.slotKey,
            slotId: executionPlan.slotId,
            sessionKey: executionPlan.sessionKey,
            piSessionDir: executionPlan.sessionPersistence?.sessionDir ?? null,
            workspaceId: executionPlan.workspaceId,
          },
          'agent-daemon.task_execution_policy',
        );
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
        if (executionPlan.slotKey && executionPlan.sessionPersistence) {
          slotRegistry.beginSlot({
            ...slotIdentity,
            slotKey: executionPlan.slotKey,
            taskType: claimedTask.task.taskType,
            sessionDir: executionPlan.sessionPersistence.sessionDir,
            sessionPath: resolveLatestPiSessionPath(
              executionPlan.sessionPersistence.sessionDir,
            ),
            workspaceId: executionPlan.workspaceId,
            worktreePath: executionPlan.workspaceId
              ? resolveTaskWorktreePath(mainRepo, executionPlan.workspaceId)
              : null,
            worktreeBranch: executionPlan.worktreeBranch,
            lastTaskId: claimedTask.task.id,
            lastAttemptN: claimedTask.attemptN,
            ttlSec: common.warmSessionTtlSec,
          });
        }
        try {
          return await executeTask(claimedTask, reporter);
        } finally {
          executionPlans.delete(buildClaimedTaskKey(claimedTask));
          if (executionPlan.slotKey) {
            slotRegistry.finishSlot(
              slotIdentity,
              executionPlan.slotKey,
              common.warmSessionTtlSec,
              executionPlan.sessionPersistence
                ? resolveLatestPiSessionPath(
                    executionPlan.sessionPersistence.sessionDir,
                  )
                : null,
            );
          }
        }
      },
    });

    const drained = await runtime.start();
    outputs.push(...drained);
    rootLogger.info({ processed: drained.length }, 'agent-daemon.drained');
    const anyFailed = drained.some((o) => o.status !== 'completed');
    return anyFailed ? 1 : 0;
  } finally {
    slotRegistry.close();
    await otelShutdown();
    await shutdownLogger();
  }
}

function buildClaimedTaskKey(
  task: Pick<ClaimedTask, 'task' | 'attemptN'>,
): string {
  return `${task.task.id}:${task.attemptN}`;
}

function getOrCreateExecutionPlan(
  claimedTask: Pick<ClaimedTask, 'task' | 'attemptN'>,
  executionPlans: Map<string, DaemonTaskExecutionPlan>,
  stateDirs: ReturnType<typeof ensureDaemonStateDirs>,
  slotIdentity: DaemonSlotIdentity,
  warmSessionTtlSec: number,
): DaemonTaskExecutionPlan {
  const key = buildClaimedTaskKey(claimedTask);
  const existing = executionPlans.get(key);
  if (existing) return existing;

  const plan = buildDaemonTaskExecutionPlan(
    claimedTask.task,
    stateDirs,
    slotIdentity,
    warmSessionTtlSec,
  );
  executionPlans.set(key, plan);
  return plan;
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
