// Shared poll-loop runner for `poll` and `drain` (only difference: stopWhenEmpty).
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { TaskOutput } from '@moltnet/tasks';
import {
  type DaemonSlotIdentity,
  DaemonSlotRegistry,
  resolveDaemonStateStorageConfig,
  resolveLatestPiSessionPath,
} from '@themoltnet/agent-daemon-state';
import {
  AgentRuntime,
  ApiTaskReporter,
  PollingApiTaskSource,
} from '@themoltnet/agent-runtime';
import {
  createPiTaskExecutor,
  findMainWorktree,
} from '@themoltnet/pi-extension';

import { loadConfig } from '../config.js';
import { resolveAgentContext } from '../lib/agent-context.js';
import {
  createGhCliClient,
  makePrBodyAnchorWriter,
} from '../lib/correlation.js';
import {
  createExecutionPlanCache,
  ProducerContextResolutionError,
} from '../lib/execution-plan-cache.js';
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
import {
  resolveProfileWarmSessionTtlSec,
  resolveRuntimeProfile,
  validateRuntimeProfilePrerequisites,
} from '../lib/runtime-profile.js';
import { resolveSandbox } from '../lib/sandbox.js';
import { installShutdownSignalHandlers } from '../lib/shutdown-signal.js';
import { ensureDaemonStateDirs } from '../lib/state-dir.js';
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
      profile: { type: 'string' },
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
    common = parseCommonOptions(values, {
      requireProviderModel: !values.profile,
    });
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

  if (values.profile && values.sandbox) {
    console.error(
      `[${opts.modeLabel}] Cannot use --sandbox with --profile. ` +
        'Remote runtime profiles define sandbox policy.',
    );
    return 1;
  }

  if (taskTypes.length === 0) {
    console.error(
      `[${opts.modeLabel}] --task-types is empty — daemon will accept any registered type. ` +
        'Pass an explicit list to limit scope (e.g. --task-types fulfill_brief).',
    );
  }

  const cfg = loadConfig();
  const initialCommon = common;
  const ctx = await resolveAgentContext(initialCommon.agent);
  const profile = values.profile
    ? await resolveRuntimeProfile({
        agent: ctx.agent,
        profile: values.profile,
        teamId,
        cwd: process.cwd(),
      })
    : null;
  if (profile) {
    validateRuntimeProfilePrerequisites(
      profile,
      cfg.profilePrerequisiteEnv,
      cfg.profilePrerequisitePath,
    );
    common = parseCommonOptions(values, {
      requireProviderModel: false,
      runtimeDefaults: {
        leaseTtlSec: profile.leaseTtlSec,
        heartbeatIntervalMs: profile.heartbeatIntervalMs,
        maxBatchSize: profile.maxBatchSize,
        warmSessionTtlSec: resolveProfileWarmSessionTtlSec(profile),
      },
    });
  }
  const provider = profile?.provider ?? common.provider;
  const model = profile?.model ?? common.model;
  if (!provider || !model) {
    throw new Error('provider/model missing after runtime profile resolution');
  }
  const sandbox = profile
    ? {
        config: profile.sandboxConfig,
        rootDir: profile.mountPath,
        path: profile.source,
      }
    : resolveSandbox(process.cwd(), values.sandbox);
  const stateDirs = ensureDaemonStateDirs(sandbox.rootDir);
  const slotRegistry = new DaemonSlotRegistry(
    resolveDaemonStateStorageConfig(
      stateDirs.registryDbPath,
      cfg.agentDaemonStateDatabaseUrl,
    ),
  );
  const slotIdentity: DaemonSlotIdentity = {
    agentName: common.agent,
    provider,
    model,
  };
  const mainRepo = findMainWorktree();
  const executionPlans = createExecutionPlanCache({
    stateDirs,
    slotIdentity,
    warmSessionTtlSec: common.warmSessionTtlSec,
    slotRegistry,
  });
  const otelShutdown = await initWorkerOtel({
    serviceName: opts.serviceName,
    agentDir: ctx.agentDir,
    endpoint: cfg.otelEndpoint,
    resourceAttributes: {
      'moltnet.team.id': teamId,
      'moltnet.agent.name': common.agent,
      'moltnet.llm.provider': provider,
      'moltnet.llm.model': model,
      ...(profile ? { 'moltnet.daemon_profile.id': profile.id } : {}),
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
    provider,
    model,
    ...(profile
      ? { daemonProfileId: profile.id, daemonProfileName: profile.name }
      : {}),
  });

  const abort = new AbortController();
  let runtime: AgentRuntime | null = null;
  const signalHandlers = installShutdownSignalHandlers({
    logDrain: (signal) => {
      rootLogger.warn({ signal }, 'agent-daemon.draining');
    },
    drain: (signal) => {
      abort.abort();
      runtime?.stop(`agent-daemon received ${signal}`);
    },
  });

  rootLogger.info(
    {
      sandbox: sandbox.path,
      taskTypes: taskTypes.length > 0 ? taskTypes : ['*'],
      diaryIds: diaryIds.length > 0 ? diaryIds : ['*'],
      leaseTtlSec: common.leaseTtlSec,
      heartbeatIntervalMs: common.heartbeatIntervalMs,
      warmSessionTtlSec: common.warmSessionTtlSec,
      pollIntervalMs,
      maxPollIntervalMs,
      ...(profile
        ? {
            profileId: profile.id,
            profileSessionTtlSec: profile.sessionTtlSec,
            profileWorkspaceTtlSec: profile.workspaceTtlSec,
          }
        : {}),
    },
    'agent-daemon.starting',
  );

  const outputs: TaskOutput[] = [];
  try {
    const executeTask = createPiTaskExecutor({
      agentName: common.agent,
      mountPath: sandbox.rootDir,
      provider,
      model,
      sandboxConfig: sandbox.config,
      makeExecutionPlan: (claimedTask) =>
        executionPlans.getOrCreate(claimedTask),
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
        ...(profile ? { profileId: profile.id } : {}),
        diaryIds: diaryIds.length > 0 ? diaryIds : undefined,
        leaseTtlSec: common.leaseTtlSec,
        listLimit,
        pollIntervalMs,
        maxPollIntervalMs,
        signal: abort.signal,
        stopWhenEmpty: opts.stopWhenEmpty,
        debug: common.debug,
        logger: rootLogger,
        // Warm-resume affinity: skip continuations whose source warm
        // slot lives on a different daemon. See #1287.
        slotRegistry,
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
      onTaskFinished: async (output, claimedTask) => {
        // `executeTask`'s finally block has already called `finishSlot`
        // by the time we land here, so the slot's `expires_at_ms`
        // reflects the post-completion idle TTL — that's the
        // `slotResumableUntil` window we stamp on the attempt row.
        const resolved = await slotRegistry.findLatestProducerSlotByTaskAttempt(
          claimedTask.task.id,
          claimedTask.attemptN,
        );
        return finalizeTask(ctx.agent, output, {
          task: claimedTask.task,
          slot: resolved ? { expiresAtMs: resolved.slot.expiresAtMs } : null,
          writeCorrelationAnchors: makePrBodyAnchorWriter({
            gh: createGhCliClient(),
            logger: rootLogger,
          }),
          log: (msg, err) => rootLogger.warn({ err }, msg),
        });
      },
      executeTask: async (claimedTask, reporter) => {
        let executionPlan: Awaited<
          ReturnType<typeof executionPlans.getOrCreate>
        >;
        try {
          executionPlan = await executionPlans.getOrCreate(claimedTask);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          rootLogger.warn(
            {
              taskId: claimedTask.task.id,
              attemptN: claimedTask.attemptN,
              err: message,
            },
            'agent-daemon.execution_plan_failed',
          );
          return {
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
            status: 'failed',
            output: null,
            outputCid: null,
            usage: { inputTokens: 0, outputTokens: 0 },
            durationMs: 0,
            error: {
              code:
                err instanceof ProducerContextResolutionError
                  ? 'producer_context_missing'
                  : 'execution_plan_failed',
              message,
              retryable: false,
            },
          };
        }
        const sessionDescriptor = executionPlan.descriptor;
        let expired: Awaited<ReturnType<typeof slotRegistry.reapExpiredSlots>>;
        try {
          expired = await slotRegistry.reapExpiredSlots();
          if (expired.length > 0) {
            rootLogger.info(
              {
                expiredCount: expired.length,
                slotKeys: expired.map((item) => item.slot.slotKey),
              },
              'agent-daemon.daemon_slots_reaped',
            );
          }
        } catch (err) {
          rootLogger.error(
            {
              phase: 'daemon_slot_reap',
              err: err instanceof Error ? err.message : String(err),
            },
            'agent-daemon.daemon_slot_reap_failed',
          );
        }
        rootLogger.debug(
          {
            taskId: claimedTask.task.id,
            taskType: claimedTask.task.taskType,
            resumable: sessionDescriptor.policy.resumable,
            workspaceMode: executionPlan.workspaceMode,
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
        // from the server — e.g. the proposer cancelled between claim and
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
          await slotRegistry.beginSlot({
            ...slotIdentity,
            slotKey: executionPlan.slotKey,
            taskType: claimedTask.task.taskType,
            sessionDir: executionPlan.sessionPersistence.sessionDir,
            sessionPath: resolveLatestPiSessionPath(
              executionPlan.sessionPersistence.sessionDir,
            ),
            workspaceId: executionPlan.workspaceId,
            worktreePath: resolveRecordedWorkspacePath(
              mainRepo,
              stateDirs.rootDir,
              executionPlan,
            ),
            worktreeBranch: executionPlan.worktreeBranch,
            lastTaskId: claimedTask.task.id,
            lastAttemptN: claimedTask.attemptN,
            ttlSec: common.warmSessionTtlSec,
          });
        }
        try {
          return await executeTask(claimedTask, reporter);
        } finally {
          executionPlans.delete(claimedTask);
          if (executionPlan.slotKey) {
            await slotRegistry.finishSlot(
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
    signalHandlers.dispose();
    await slotRegistry.close();
    await otelShutdown();
    await shutdownLogger();
  }
}

function resolveRecordedWorkspacePath(
  mainRepo: string,
  stateRootDir: string,
  executionPlan: {
    workspaceId: string | null;
    workspaceMode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
  },
): string | null {
  if (!executionPlan.workspaceId) return null;
  return executionPlan.workspaceMode === 'scratch_mount'
    ? join(stateRootDir, 'task-workspaces', executionPlan.workspaceId)
    : join(mainRepo, '.worktrees', executionPlan.workspaceId);
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
