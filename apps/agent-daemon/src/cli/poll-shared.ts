// Shared poll-loop runner for `poll` and `drain` (only difference: stopWhenEmpty).
import { join } from 'node:path';
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
} from '@themoltnet/pi-extension';

import { activatePiCodingAgentDir, loadConfig } from '../config.js';
import { resolveAgentContext } from '../lib/agent-context.js';
import {
  createGhCliClient,
  makePrBodyAnchorWriter,
} from '../lib/correlation.js';
import type { DaemonSlotIdentity } from '../lib/daemon-slot-identity.js';
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
import { ensurePiAgentDir } from '../lib/pi-agent-dir.js';
import { runWithDaemonRuntimeContext } from '../lib/runtime-context.js';
import {
  type ResolvedRuntimeProfile,
  resolveProfileWarmSessionTtlSec,
  resolveRuntimeProfiles,
  validateRuntimeProfilePrerequisites,
} from '../lib/runtime-profile.js';
import { createApiRuntimeSlotStore } from '../lib/runtime-slots.js';
import { resolveLatestPiSessionPath } from '../lib/session-files.js';
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

interface ProfileRuntime {
  common: CommonOptions;
  profile: ResolvedRuntimeProfile;
  sandbox: {
    config: ResolvedRuntimeProfile['sandboxConfig'];
    rootDir: string;
    path: string;
  };
  stateDirs: ReturnType<typeof ensureDaemonStateDirs>;
  piAgentDir: ReturnType<typeof ensurePiAgentDir>;
  slotIdentity: DaemonSlotIdentity;
  executionPlans: ReturnType<typeof createExecutionPlanCache>;
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
      profile: { type: 'string', multiple: true },
    },
  });

  if (!values.team) {
    console.error('Missing required flag: --team\n');
    console.error(opts.helpText);
    return 1;
  }

  const teamId = values.team;
  const profileValues = parseProfileValues(values.profile);
  if (profileValues.length === 0) {
    console.error('Missing required flag: --profile\n');
    console.error(opts.helpText);
    return 1;
  }
  let taskTypes: string[];
  try {
    taskTypes = validateTaskTypes(parseCsv(values['task-types']));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    return 1;
  }
  const diaryIds = parseCsv(values['diary-ids']);
  let baseCommon: CommonOptions;
  try {
    baseCommon = parseCommonOptions(values);
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

  if (values.sandbox) {
    console.error(
      `[${opts.modeLabel}] Cannot use --sandbox. ` +
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
  const ctx = await resolveAgentContext(baseCommon.agent, {
    agentRootDir: process.cwd(),
  });
  const profiles = await resolveRuntimeProfiles({
    agent: ctx.agent,
    profiles: profileValues,
    teamId,
    cwd: process.cwd(),
  });
  for (const profile of profiles) {
    validateRuntimeProfilePrerequisites(
      profile,
      cfg.profilePrerequisiteEnv,
      cfg.profilePrerequisitePath,
    );
  }
  const slotRegistry = createApiRuntimeSlotStore({ agent: ctx.agent });
  const runtimes = new Map<string, ProfileRuntime>();
  for (const profile of profiles) {
    const common = parseCommonOptions(values, {
      runtimeDefaults: {
        leaseTtlSec: profile.leaseTtlSec,
        heartbeatIntervalMs: profile.heartbeatIntervalMs,
        maxBatchSize: profile.maxBatchSize,
        warmSessionTtlSec: resolveProfileWarmSessionTtlSec(profile),
      },
    });
    const sandbox = {
      config: profile.sandboxConfig,
      rootDir: profile.mountPath,
      path: profile.source,
    };
    const piAgentDir = ensurePiAgentDir(sandbox.rootDir, cfg.piCodingAgentDir);
    const stateDirs = ensureDaemonStateDirs(sandbox.rootDir);
    const slotIdentity: DaemonSlotIdentity = {
      agentName: common.agent,
      runtimeProfileId: profile.id,
    };
    const executionPlans = createExecutionPlanCache({
      stateDirs,
      slotIdentity,
      warmSessionTtlSec: common.warmSessionTtlSec,
      slotRegistry,
    });
    runtimes.set(profile.id, {
      common,
      profile,
      sandbox,
      stateDirs,
      piAgentDir,
      slotIdentity,
      executionPlans,
    });
  }
  const firstRuntime = runtimes.get(profiles[0].id);
  if (!firstRuntime) {
    throw new Error('No runtime profiles resolved');
  }
  const piAgentDir = firstRuntime.piAgentDir;
  activatePiCodingAgentDir(piAgentDir.path);
  const otelShutdown = await initWorkerOtel({
    serviceName: opts.serviceName,
    agentDir: ctx.agentDir,
    endpoint: cfg.otelEndpoint,
    resourceAttributes: {
      'moltnet.team.id': teamId,
      'moltnet.agent.name': baseCommon.agent,
      'moltnet.runtime_profile.count': String(profiles.length),
      'moltnet.runtime_profile.ids': profiles.map((p) => p.id).join(','),
    },
  });

  const { logger, shutdown: shutdownLogger } = createRootLogger({
    name: `agent-daemon.${opts.modeLabel}`,
    level: cfg.logLevel || (baseCommon.debug ? 'debug' : 'info'),
  });
  const rootLogger = logger.child({
    mode: opts.modeLabel,
    agent: baseCommon.agent,
    teamId,
    runtimeProfileIds: profiles.map((p) => p.id),
    runtimeProfileNames: profiles.map((p) => p.name),
  });

  const abort = new AbortController();
  let runtime: AgentRuntime | null = null;
  // Track the in-flight task+attempt so a SIGINT/SIGTERM `drain` can abort
  // exactly the running attempt server-side (#1382) instead of leaving it
  // to lease-expire. Poll mode runs one task at a time through the runtime
  // loop, so a single ref pair is sufficient. Null when the loop is idle.
  let active: { taskId: string; attemptN: number } | null = null;
  const signalHandlers = installShutdownSignalHandlers({
    logDrain: (signal) => {
      rootLogger.warn({ signal }, 'agent-daemon.draining');
    },
    drain: (signal) => {
      abort.abort();
      runtime?.stop(`agent-daemon received ${signal}`);
      // Abort the active attempt rather than letting it lease-expire. The
      // task requeues for another daemon / retry; it is NOT cancelled.
      if (active === null) return;
      const { taskId, attemptN } = active;
      void ctx.agent.tasks
        .abortAttempt(taskId, attemptN, {
          reason: `runner_${signal.toLowerCase()}`,
        })
        .catch((err: unknown) => {
          try {
            rootLogger.warn(
              {
                err: err instanceof Error ? err.message : String(err),
                taskId,
                attemptN,
              },
              'agent-daemon.abort_on_signal_failed',
            );
          } catch {
            // best-effort logging; never block SIGKILL deadline
          }
        });
    },
  });

  rootLogger.info(
    {
      taskTypes: taskTypes.length > 0 ? taskTypes : ['*'],
      diaryIds: diaryIds.length > 0 ? diaryIds : ['*'],
      pollIntervalMs,
      maxPollIntervalMs,
      profiles: profiles.map((profile) => {
        const runtime = requireRuntime(runtimes, profile.id);
        return {
          id: profile.id,
          name: profile.name,
          provider: profile.provider,
          model: profile.model,
          sandbox: runtime.sandbox.path,
          leaseTtlSec: runtime.common.leaseTtlSec,
          heartbeatIntervalMs: runtime.common.heartbeatIntervalMs,
          warmSessionTtlSec: runtime.common.warmSessionTtlSec,
          profileSessionTtlSec: profile.sessionTtlSec,
          profileWorkspaceTtlSec: profile.workspaceTtlSec,
        };
      }),
      piAgentDir: piAgentDir.path,
      piAgentDirSource: piAgentDir.source,
    },
    'agent-daemon.starting',
  );

  const outputs: TaskOutput[] = [];
  try {
    runtime = new AgentRuntime({
      logger: rootLogger,
      source: new PollingApiTaskSource({
        agent: ctx.agent,
        teamId,
        taskTypes: taskTypes.length > 0 ? taskTypes : undefined,
        profiles: profiles.map((profile) => ({
          profileId: profile.id,
          leaseTtlSec: requireRuntime(runtimes, profile.id).common.leaseTtlSec,
        })),
        diaryIds: diaryIds.length > 0 ? diaryIds : undefined,
        leaseTtlSec: firstRuntime.common.leaseTtlSec,
        listLimit,
        pollIntervalMs,
        maxPollIntervalMs,
        signal: abort.signal,
        stopWhenEmpty: opts.stopWhenEmpty,
        debug: baseCommon.debug,
        logger: rootLogger,
        // Warm-resume affinity: skip continuations whose source warm
        // slot lives on a different daemon. See #1287.
        slotRegistry,
      }),
      makeReporter: (claimedTask) => {
        const selected = runtimeForClaimedTask(runtimes, claimedTask);
        return new ApiTaskReporter({
          tasks: ctx.agent.tasks,
          leaseTtlSec: selected.common.leaseTtlSec,
          heartbeatIntervalMs: selected.common.heartbeatIntervalMs,
          maxBatchSize: selected.common.maxBatchSize,
          flushIntervalMs: selected.common.flushIntervalMs,
        });
      },
      // Finalize each task as soon as the executor resolves — long-
      // polling sources never terminate, so deferring `/complete` to
      // after `runtime.start()` would let every lease expire even when
      // the judge submitted a clean payload. The post-drain finalize
      // loop that used to live below is gone: it would now double-
      // call `/complete` on every task and the server returns 409
      // "Task is already in terminal state" on the second call.
      onTaskFinished: async (output, claimedTask) => {
        const selected = runtimeForClaimedTask(runtimes, claimedTask);
        // `executeTask`'s finally block has already called `finishSlot`
        // by the time we land here, so the slot's `expires_at_ms`
        // reflects the post-completion idle TTL — that's the
        // `slotResumableUntil` window we stamp on the attempt row.
        const resolved = await slotRegistry.findLatestSlotByTaskAttempt(
          claimedTask.task.teamId,
          claimedTask.task.id,
          claimedTask.attemptN,
        );
        return finalizeTask(ctx.agent, output, {
          task: claimedTask.task,
          slot: resolved ? { expiresAtMs: resolved.slot.expiresAtMs } : null,
          writeCorrelationAnchors: makePrBodyAnchorWriter({
            gh: createGhCliClient(),
            logger: rootLogger.child({
              runtimeProfileId: selected.profile.id,
              runtimeProfileName: selected.profile.name,
            }),
          }),
          log: (msg, err) => rootLogger.warn({ err }, msg),
        });
      },
      executeTask: async (claimedTask, reporter) => {
        const selected = runtimeForClaimedTask(runtimes, claimedTask);
        const {
          common,
          executionPlans,
          profile,
          sandbox,
          slotIdentity,
          stateDirs,
        } = selected;
        const taskLogger = rootLogger.child({
          runtimeProfileId: profile.id,
          runtimeProfileName: profile.name,
          provider: profile.provider,
          model: profile.model,
        });
        let executionPlan: Awaited<
          ReturnType<typeof executionPlans.getOrCreate>
        >;
        try {
          executionPlan = await executionPlans.getOrCreate(claimedTask);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          taskLogger.warn(
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
        taskLogger.debug(
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
            runtimeProfileId: profile.id,
            provider: profile.provider,
            model: profile.model,
            teamId: claimedTask.task.teamId,
            slotKey: executionPlan.slotKey,
            taskType: claimedTask.task.taskType,
            sessionDir: executionPlan.sessionPersistence.sessionDir,
            sessionPath: resolveLatestPiSessionPath(
              executionPlan.sessionPersistence.sessionDir,
            ),
            workspaceId: executionPlan.workspaceId,
            worktreePath: resolveRecordedWorkspacePath(
              stateDirs.rootDir,
              executionPlan,
            ),
            worktreeBranch: executionPlan.worktreeBranch,
            workspaceKind: executionPlan.workspaceKind,
            lastTaskId: claimedTask.task.id,
            lastAttemptN: claimedTask.attemptN,
          });
        }
        const rawExecuteTask = createPiTaskExecutor({
          agentName: common.agent,
          mountPath: sandbox.rootDir,
          provider: profile.provider,
          model: profile.model,
          sandboxConfig: sandbox.config,
          makeExecutionPlan: (task) => executionPlans.getOrCreate(task),
          makeOnTurnEvent: makeTurnEventHandlerFactory(taskLogger),
          maxTurns: common.maxTurns,
          maxBashTimeouts: common.maxBashTimeouts,
        });
        try {
          active = {
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
          };
          return await runWithDaemonRuntimeContext(
            {
              profileId: profile.id,
              profileName: profile.name,
              provider: profile.provider,
              model: profile.model,
            },
            () => rawExecuteTask(claimedTask, reporter),
          );
        } finally {
          active = null;
          executionPlans.delete(claimedTask);
          if (executionPlan.slotKey) {
            await slotRegistry.finishSlot(
              claimedTask.task.teamId,
              claimedTask.task.id,
              claimedTask.attemptN,
              slotIdentity,
              executionPlan.slotKey,
              profile.provider,
              profile.model,
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
  stateRootDir: string,
  executionPlan: {
    workspaceId: string | null;
    workspaceMode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
  },
): string | null {
  if (!executionPlan.workspaceId) return null;
  return executionPlan.workspaceMode === 'scratch_mount'
    ? join(stateRootDir, 'task-workspaces', executionPlan.workspaceId)
    : join(findMainWorktree(), '.worktrees', executionPlan.workspaceId);
}

function runtimeForClaimedTask(
  runtimes: ReadonlyMap<string, ProfileRuntime>,
  claimedTask: ClaimedTask,
): ProfileRuntime {
  if (!claimedTask.profileId) {
    throw new Error(
      `Claimed task ${claimedTask.task.id} did not include a selected runtime profile`,
    );
  }
  return requireRuntime(runtimes, claimedTask.profileId);
}

function requireRuntime(
  runtimes: ReadonlyMap<string, ProfileRuntime>,
  profileId: string,
): ProfileRuntime {
  const runtime = runtimes.get(profileId);
  if (!runtime) {
    throw new Error(`No runtime profile configured for ${profileId}`);
  }
  return runtime;
}

function parseProfileValues(raw: string[] | undefined): string[] {
  return (raw ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
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
