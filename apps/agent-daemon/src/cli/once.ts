import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  type DaemonSlotIdentity,
  DaemonSlotRegistry,
  resolveDaemonStateStorageConfig,
  resolveLatestPiSessionPath,
} from '@themoltnet/agent-daemon-state';
import {
  AgentRuntime,
  ApiTaskReporter,
  ApiTaskSource,
  type TaskExecutor,
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
import { isHelpFlag, ONCE_HELP } from '../lib/help.js';
import { createRootLogger } from '../lib/logger.js';
import {
  commonOptionDefs,
  type CommonOptions,
  MissingRequiredOptionError,
  parseCommonOptions,
} from '../lib/options.js';
import { initWorkerOtel } from '../lib/otel.js';
import { resolveSandbox } from '../lib/sandbox.js';
import { ensureDaemonStateDirs } from '../lib/state-dir.js';
import { makeTurnEventHandler } from '../lib/turn-event-logger.js';

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
  const cfg = loadConfig();
  const stateDirs = ensureDaemonStateDirs(sandbox.rootDir);
  const slotRegistry = new DaemonSlotRegistry(
    resolveDaemonStateStorageConfig(
      stateDirs.registryDbPath,
      cfg.agentDaemonStateDatabaseUrl,
    ),
  );
  const slotIdentity: DaemonSlotIdentity = {
    agentName: opts.agent,
    provider: opts.provider,
    model: opts.model,
  };
  const mainRepo = findMainWorktree();
  const executionPlans = createExecutionPlanCache({
    stateDirs,
    slotIdentity,
    warmSessionTtlSec: opts.warmSessionTtlSec,
    slotRegistry,
  });
  const ctx = await resolveAgentContext(opts.agent);

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

  const { logger, shutdown: shutdownLogger } = createRootLogger({
    name: 'agent-daemon.once',
    level: cfg.logLevel || (opts.debug ? 'debug' : 'info'),
  });
  const rootLogger = logger.child({
    mode: 'once',
    agent: opts.agent,
    provider: opts.provider,
    model: opts.model,
  });

  rootLogger.info({ sandbox: sandbox.path, taskId }, 'agent-daemon.starting');

  // Wire SIGTERM/SIGINT for cooperative shutdown. GitHub-hosted runners
  // send SIGTERM 5 minutes before `timeout-minutes` expires (then
  // SIGKILL on expiry); using that grace window to issue a server-side
  // `tasks.cancel()` lets the workflow flip the attempt from
  // `running` → `cancelled` cleanly instead of waiting on the
  // ~5min lease_expired path. Idempotent: cancel-on-already-terminal
  // is a server-side no-op.
  let runtime: AgentRuntime | null = null;
  const onSignal = (sig: string): void => {
    rootLogger.warn({ signal: sig, taskId }, 'agent-daemon.draining');
    runtime?.stop();
    // Fire-and-forget: cancel reaches the workflow and surfaces back
    // through the reporter's `cancelSignal`, which pi-extension uses
    // to abort the LLM session. We don't await — SIGKILL deadline is
    // 5 min away and the executor needs every second.
    void ctx.agent.tasks
      .cancel(taskId, { reason: `runner_${sig.toLowerCase()}` })
      .catch((err: unknown) => {
        // Cancel-on-already-terminal returns a 4xx; ignore. Other
        // errors are visible in the daemon log but shouldn't block
        // SIGKILL — the server's lease check is the backstop.
        rootLogger.warn(
          { err: err instanceof Error ? err.message : String(err), taskId },
          'agent-daemon.cancel_on_signal_failed',
        );
      });
  };
  process.on('SIGINT', () => {
    onSignal('SIGINT');
  });
  process.on('SIGTERM', () => {
    onSignal('SIGTERM');
  });

  try {
    const rawExecuteTask = createPiTaskExecutor({
      agentName: opts.agent,
      mountPath: sandbox.rootDir,
      provider: opts.provider,
      model: opts.model,
      sandboxConfig: sandbox.config,
      makeExecutionPlan: (claimedTask) =>
        executionPlans.getOrCreate(claimedTask),
      onTurnEvent: makeTurnEventHandler(rootLogger, { taskId }),
      maxTurns: opts.maxTurns,
      maxBashTimeouts: opts.maxBashTimeouts,
    });
    const executeTask: TaskExecutor = async (claimedTask, reporter) => {
      try {
        const expired = await slotRegistry.reapExpiredSlots();
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
      let executionPlan: Awaited<ReturnType<typeof executionPlans.getOrCreate>>;
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
          ttlSec: opts.warmSessionTtlSec,
        });
      }
      try {
        return await rawExecuteTask(claimedTask, reporter);
      } finally {
        executionPlans.delete(claimedTask);
        if (executionPlan.slotKey) {
          await slotRegistry.finishSlot(
            slotIdentity,
            executionPlan.slotKey,
            opts.warmSessionTtlSec,
            executionPlan.sessionPersistence
              ? resolveLatestPiSessionPath(
                  executionPlan.sessionPersistence.sessionDir,
                )
              : null,
          );
        }
      }
    };

    const writeCorrelationAnchors = makePrBodyAnchorWriter({
      gh: createGhCliClient(),
      logger: rootLogger,
    });

    runtime = new AgentRuntime({
      logger: rootLogger,
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
      // Finalize inside the runtime loop so the correlation anchor writer
      // sees the claimedTask alongside its output. once mode only ever
      // claims one task, so this fires exactly once.
      onTaskFinished: async (output, claimedTask) => {
        // Look up the slot record at finalize time. `executeTask`'s
        // finally block has already called `finishSlot` which updates
        // `expires_at_ms` to the post-completion idle TTL — that's
        // exactly the `slotResumableUntil` window we want stamped on
        // the attempt row.
        const resolved = await slotRegistry.findLatestProducerSlotByTaskAttempt(
          claimedTask.task.id,
          claimedTask.attemptN,
        );
        return finalizeTask(ctx.agent, output, {
          task: claimedTask.task,
          slot: resolved ? { expiresAtMs: resolved.slot.expiresAtMs } : null,
          writeCorrelationAnchors,
          log: (msg, err) => rootLogger.warn({ err }, msg),
        });
      },
      executeTask,
    });

    const outputs = await runtime.start();
    const [output] = outputs;
    if (!output) {
      rootLogger.error({}, 'agent-daemon.no_output');
      return 1;
    }
    console.log('\n[done] TaskOutput:');
    console.log(JSON.stringify(output, null, 2));
    return output.status === 'completed' ? 0 : 1;
  } finally {
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
