/**
 * executePiTask — run a single Task attempt using pi-coding-agent inside a
 * Gondolin sandbox.
 *
 * This is the pi-specific task executor. It owns:
 *   - VM lifecycle (ensureSnapshot + resumeVm + close)
 *   - Gondolin-redirected tool wiring (read/write/edit/bash/ls/find/grep → VM)
 *   - MoltNet custom tools (diary entries, pack render/judge, etc.)
 *   - pi createAgentSession + event → TaskReporter bridge
 *
 * `@moltnet/agent-runtime` is coding-agent-agnostic: it owns the Task loop,
 * reporters, sources, and prompt builders, but it does NOT depend on pi or
 * Gondolin. Concrete runtimes (this one, a future Codex one, a future direct
 * Anthropic-SDK one) plug in via the `executeTask` function injected into
 * `AgentRuntime`.
 */
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import type { VM } from '@earendil-works/gondolin';
import { type Api, getModel, type Model } from '@earendil-works/pi-ai';
import type {
  AgentSession,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { computeJsonCid } from '@moltnet/crypto-service';
import {
  buildTaskUserPrompt,
  type ClaimedTask,
  type ContextRef,
  FREEFORM_TYPE,
  materializeTaskOutput,
  type SubagentContractRegistry,
  type TaskOutput,
  type TaskReporter,
  taskTypeUsesSubagents,
  type TaskUsage,
  type TaskUserPromptContext,
  validateTaskOutput,
} from '@themoltnet/agent-runtime';
import { connect } from '@themoltnet/sdk';

import {
  createMoltNetTools,
  HOST_EXEC_DEFAULT_BASE_ENV,
  type HostExecAutoApproveConfig,
} from '../moltnet/tools.js';
import { ensureSnapshot, type SandboxConfig } from '../snapshot.js';
import {
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinFindOps,
  createGondolinLsOps,
  createGondolinReadOps,
  createGondolinWriteOps,
  executeGondolinGrep,
  toGuestPath,
} from '../tool-operations.js';
import { activateAgentEnv, resumeVm } from '../vm-manager.js';
import { buildAgentSession } from './agent-session-factory.js';
import type { PiTaskExecutionPlanFactory } from './execution-plan.js';
import type { PiThinkingLevel } from './pi-thinking-level.js';
import {
  type ContinueFromPointer,
  resolvePriorContext,
} from './resolve-prior-context.js';
import { redactRetryTriageSecrets } from './retry-triage.js';
import {
  type InjectedRuntimeContext,
  injectRuntimeContext,
  resolveEffectiveRuntimeContext,
} from './runtime-context.js';
import {
  buildRuntimeKernel,
  composeRuntimeSystemPrompt,
} from './runtime-instructor.js';
import {
  createSubagentTool,
  type SubagentToolHandle,
} from './subagent-tool.js';
import {
  resolveSubmitTools,
  type SubmitOutputToolHandle,
} from './submit-output-tool.js';
import {
  emitTaskEvent,
  type TurnEventHandler,
  type TurnEventKind,
} from './task-event-emitter.js';
import {
  type ParsedTaskOutputResult,
  parseStructuredTaskOutput,
  recordTaskOutputParseResult,
  recordTaskOutputTelemetryAnomaly,
} from './task-output.js';
import { prepareTaskWorkspace } from './task-workspace.js';

export type {
  PiSessionPersistencePlan,
  PiTaskExecutionPlan,
  PiTaskExecutionPlanFactory,
} from './execution-plan.js';
export { resolveTaskWorktreePath } from './task-workspace.js';

// Factory variant for `onTurnEvent`. Polling daemons run N tasks per
// process and need to bind per-task context (taskId, attemptN) into
// each handler — they can't do that at executor-construction time.
// The factory is invoked once per `executePiTask` call, before any
// emit, so the returned handler always carries fresh per-task context.
// See #1078 for motivation.
export type TurnEventHandlerFactory = (
  claimedTask: ClaimedTask,
) => TurnEventHandler;

const noopTurnEventHandler: TurnEventHandler = () => {};

export type ProviderErrorRetryLevel = 'info' | 'warning' | 'error';

export interface ProviderErrorRetryEvent extends Record<string, unknown> {
  event: 'provider_error_retry';
  retry: number;
  maxRetries: number;
  delayMs: number;
  reason: string;
}

export interface ProviderErrorRetryUi {
  /**
   * Mirrors pi's `ctx.hasUI`. Undefined means "UI adapter is present"; false
   * lets callers pass a stable adapter from both TUI and headless contexts.
   */
  hasUI?: boolean;
  setStatus?: (key: string, message: string) => void | Promise<void>;
  notify?: (
    message: string,
    level: ProviderErrorRetryLevel,
  ) => void | Promise<void>;
}

export async function openVmWorkspaceFileForRead(config: {
  vm: VM;
  cwdPath: string;
  guestWorkspace: string;
  filePath: string;
}) {
  const localPath = isAbsolute(config.filePath)
    ? config.filePath
    : resolve(config.cwdPath, config.filePath);
  const guestPath = toGuestPath(
    config.cwdPath,
    localPath,
    config.guestWorkspace,
  );
  const info = await config.vm.fs.stat(guestPath);
  const stream = await config.vm.fs.readFileStream(guestPath);
  return {
    stream,
    isFile: info.isFile(),
    sizeBytes: typeof info.size === 'number' ? info.size : undefined,
    displayPath: config.filePath,
  };
}

export function createGondolinToolDefinitions(config: {
  vm: VM;
  mountPath: string;
  guestWorkspace: string;
}): ToolDefinition[] {
  const { vm, mountPath, guestWorkspace } = config;
  const grepTool = createGrepToolDefinition(mountPath);
  return [
    createReadToolDefinition(mountPath, {
      operations: createGondolinReadOps(vm, mountPath, guestWorkspace),
    }),
    createWriteToolDefinition(mountPath, {
      operations: createGondolinWriteOps(vm, mountPath, guestWorkspace),
    }),
    createEditToolDefinition(mountPath, {
      operations: createGondolinEditOps(vm, mountPath, guestWorkspace),
    }),
    createBashToolDefinition(mountPath, {
      operations: createGondolinBashOps(vm, mountPath, guestWorkspace),
    }),
    createLsToolDefinition(mountPath, {
      operations: createGondolinLsOps(vm, mountPath, guestWorkspace),
    }),
    createFindToolDefinition(mountPath, {
      operations: createGondolinFindOps(vm, mountPath, guestWorkspace),
    }),
    {
      ...grepTool,
      async execute(
        ...args: Parameters<typeof grepTool.execute>
      ): ReturnType<typeof grepTool.execute> {
        const [_id, params, signal] = args;
        return executeGondolinGrep(
          vm,
          mountPath,
          guestWorkspace,
          params,
          signal,
        );
      },
    },
  ] as unknown as ToolDefinition[];
}

export interface ExecutePiTaskOptions {
  /** MoltNet agent whose credentials the VM boots with. */
  agentName: string;
  /**
   * Host root that owns `.moltnet/<agentName>/`.
   *
   * Defaults to `mountPath`, but callers that mount scratch workspaces should
   * pass the stable sandbox root.
   */
  agentRootDir?: string;
  /** Host cwd that the VM mounts into the guest (defaults to `process.cwd()`). */
  mountPath?: string;
  /** LLM selection. */
  provider: string;
  model: string;
  /**
   * Runtime-profile reasoning/thinking level. Null/undefined means use Pi's
   * configured default; explicit `off` disables provider thinking where
   * supported.
   */
  thinkingLevel?: PiThinkingLevel | null;
  /** Optional sampling temperature. Null/undefined means provider default. */
  temperature?: number | null;
  /** Optional nucleus-sampling probability mass. Null/undefined means provider default. */
  topP?: number | null;
  /** Optional top-k sampling cutoff. Null/undefined means provider default. */
  topK?: number | null;
  /** Optional cap on generated output tokens. Null/undefined means provider/model default. */
  maxOutputTokens?: number | null;
  /** Extra hosts to allow in the sandbox egress policy. */
  extraAllowedHosts?: string[];
  /** Sandbox overrides (env, VFS shadows, resources). */
  sandboxConfig?: SandboxConfig;
  /** Host environment variable names to forward into the Pi VM. */
  forwardEnv?: string[];
  /**
   * Runtime profile context defaults. Merged with task.input.context at
   * execution time because the selected runtime profile is known only after
   * claim. Task entries override profile entries with the same slug.
   */
  runtimeProfileContext?: readonly ContextRef[];
  /**
   * Forwarded to `buildTaskUserPrompt` for per-type builders. Static
   * across tasks. Today no built-in builder needs per-task `extras` —
   * judges fetch their own dependent data via MoltNet tools
   * (`moltnet_get_task`, `moltnet_list_task_attempts`, etc.) at run
   * time, which keeps this layer task-type-agnostic. Field is kept
   * for forward compat with custom prompt builders that might want it.
   */
  promptExtras?: Record<string, unknown>;
  /** Snapshot progress callback; defaults to stderr logging. */
  onSnapshotProgress?: (message: string) => void;
  /**
   * Optional pre-resolved checkpoint path. If omitted, `ensureSnapshot` is
   * invoked. Useful for batch execution where the caller wants to cache
   * across tasks.
   */
  checkpointPath?: string;
  /**
   * Lazy checkpoint resolver used by `createPiTaskExecutor` so snapshot
   * creation can happen after the reporter has been opened and can surface
   * setup failures as task messages.
   */
  resolveCheckpointPath?: () => Promise<string>;
  /**
   * Set when the caller already opened the reporter before handing control
   * to `executePiTask`.
   */
  reporterAlreadyOpened?: boolean;
  /**
   * Optional callback invoked alongside every `reporter.record()` so
   * the daemon can mirror task messages into its local logger.
   * Bound at executor-construction time — use when one task runs per
   * process (e.g. `once.ts`) and per-task context is known before
   * the executor is built. For poll mode, prefer `makeOnTurnEvent`
   * below. If both are set, `makeOnTurnEvent` wins.
   * See `TurnEventHandler` for payload shape. Defaults to a no-op.
   */
  onTurnEvent?: TurnEventHandler;
  /**
   * Per-task factory variant for `onTurnEvent`. Invoked once per
   * task with the claimed task before any emit, so the returned
   * handler can bind taskId / attemptN into a pino child.
   * Use in poll mode where N tasks run sequentially in the same
   * process. See #1078.
   */
  makeOnTurnEvent?: TurnEventHandlerFactory;
  /**
   * Cap the number of tool-use turns per attempt. When the limit is
   * reached, the pi session is aborted and the attempt finalizes with
   * `error.code: max_turns_exceeded`. A tool-use turn = any `turn_end`
   * whose `stopReason !== 'end_turn'` (matches the Anthropic SDK
   * `max_turns` semantics: the model's final text-only response doesn't
   * count). Default `0` = disabled. Recommended `30` for `fulfill_brief`.
   * Closes part of #1094.
   */
  maxTurns?: number;
  /**
   * Cap the number of `bash` tool timeouts per attempt. A timeout is a
   * `tool_execution_end` for `bash` whose result text contains
   * "Command timed out after" (pi's stable error wrapper from
   * `@earendil-works/pi-coding-agent`'s bash tool). When the limit is
   * reached, the pi session is aborted and the attempt finalizes with
   * `error.code: max_bash_timeouts_exceeded`. Catches the death-spiral
   * pattern from task `a3762f44` where the model kept retrying
   * long-blocking shell commands until the host job timeout fired.
   * Default `3`. Set to `0` to disable. Closes part of #1094.
   */
  maxBashTimeouts?: number;
  /**
   * Number of correction turns allowed after the first invalid submit-output
   * tool call. A value of 2 permits three invalid submit calls total before
   * the attempt fails with output_validation_failed.
   */
  maxSubmitValidationRetries?: number;
  /**
   * Number of same-session re-prompts when the model ends its turn WITHOUT
   * calling the submit-output tool at all (no captured payload and no
   * exhausted validation budget). Distinct from
   * `maxSubmitValidationRetries`, which recovers *invalid-args* submit calls.
   * Each re-prompt names the submit tool and forbids a prose reply. When the
   * budget is spent the attempt still fails with `submit_output_missing`.
   * Only applies to task types that register a submit tool. Default `3`. Set
   * to `0` to disable. See #1528.
   */
  maxSubmitMissingReprompts?: number;
  /**
   * Continuation prompt sent when a turn ends without a submit call. Defaults
   * to `buildSubmitMissingPrompt(<tool name>)`.
   */
  submitMissingPrompt?: string;
  /**
   * Cap provider-error retries inside the same Pi session. A retry is attempted
   * only after a Pi assistant turn ends with `stopReason: "error"` and the
   * provider diagnostic is not a known credential/model/config failure. This is
   * distinct from daemon attempt retry: the active session keeps its context and
   * receives a short continuation prompt.
   *
   * Default `2`. Set to `0` to disable.
   */
  maxProviderErrorRetries?: number;
  /** Base delay for same-session provider-error retries. Default `2000`. */
  providerErrorRetryBaseDelayMs?: number;
  /** Maximum delay for same-session provider-error retries. Default `30000`. */
  providerErrorRetryMaxDelayMs?: number;
  /** Continuation prompt sent after a retryable provider error. Default `Go on`. */
  providerErrorRetryPrompt?: string;
  /**
   * Optional UI adapter for interactive pi/TUI callers. The daemon normally
   * leaves this unset and consumes the structured `provider_error_retry` task
   * message instead.
   */
  providerErrorRetryUi?: ProviderErrorRetryUi;
  /**
   * Skip per-call UI approval for matching `moltnet_host_exec` commands.
   * Keep false/undefined for interactive consumers. `true` skips every dialog
   * after HOST_EXEC_ALLOWED; an array limits auto-approval to matching rules.
   */
  hostExecAutoApprove?: HostExecAutoApproveConfig;
  /**
   * Optional daemon-supplied execution plan. Keeps task semantics out of
   * `pi-extension` while still letting callers opt into stable worktrees and
   * file-backed Pi sessions for selected task classes.
   */
  makeExecutionPlan?: PiTaskExecutionPlanFactory;

  /**
   * Immutable subagent contract registry used to resolve `output_schema`
   * names at subagent tool call time. Constructed by the daemon (or
   * tests) from static built-in schemas — `execute-pi-task` never hardcodes
   * contracts. See #1106.
   */
  subagentContractRegistry?: SubagentContractRegistry;
}

/**
 * Factory that builds a pi-specific `executeTask` function suitable for
 * injection into `AgentRuntime`. The returned function caches the resolved
 * checkpoint across tasks so the second task hits the snapshot cache.
 */
export function createPiTaskExecutor(
  opts: ExecutePiTaskOptions,
): (claimedTask: ClaimedTask, reporter: TaskReporter) => Promise<TaskOutput> {
  let cachedCheckpoint: string | null = opts.checkpointPath ?? null;

  return async (claimedTask, reporter) => {
    const reporterWasOpened = !reporter.cancelSignal.aborted;
    if (reporterWasOpened) {
      await reporter.open({
        taskId: claimedTask.task.id,
        attemptN: claimedTask.attemptN,
      });
    }
    return executePiTask(claimedTask, reporter, {
      ...opts,
      checkpointPath: cachedCheckpoint ?? undefined,
      resolveCheckpointPath: async () => {
        if (!cachedCheckpoint) {
          cachedCheckpoint = await ensureSnapshot({
            config: opts.sandboxConfig?.snapshot,
            onProgress:
              opts.onSnapshotProgress ??
              ((m) => {
                process.stderr.write(`[snapshot] ${m}\n`);
              }),
          });
        }
        return cachedCheckpoint;
      },
      reporterAlreadyOpened: reporterWasOpened,
    });
  };
}

/**
 * Run one attempt of `task` in a freshly-resumed Gondolin VM. Owns the full
 * lifecycle: resume VM → wire tools → pi session → close VM. Always returns
 * a `TaskOutput` (failures surface as `status: 'failed'`); throws only on
 * unrecoverable setup errors.
 */
export async function executePiTask(
  claimedTask: ClaimedTask,
  reporter: TaskReporter,
  opts: ExecutePiTaskOptions,
): Promise<TaskOutput> {
  const task = claimedTask.task;
  const attemptN = claimedTask.attemptN;
  const startTime = Date.now();
  const requestedMountPath = opts.mountPath ?? process.cwd();
  const agentRootDir = opts.agentRootDir ?? requestedMountPath;
  const executionPlan = (await opts.makeExecutionPlan?.(claimedTask)) ?? null;
  let workspace: Awaited<ReturnType<typeof prepareTaskWorkspace>> | null = null;
  let mountPath = requestedMountPath;
  let cwdPath = requestedMountPath;

  // Pre-execute cancel guard. If the reporter's cancel signal is already
  // aborted (the proposer cancelled between claim and executor entry), don't
  // burn a snapshot resume + VM boot on work that's already terminal. The
  // daemon's finalizeTask treats `cancelled` outputs as no-ops on the wire,
  // which is correct: the row is already terminal server-side.
  if (reporter.cancelSignal.aborted) {
    return {
      taskId: task.id,
      attemptN,
      status: 'cancelled',
      output: null,
      outputCid: null,
      usage: emptyUsage(opts.provider, opts.model),
      durationMs: Date.now() - startTime,
      error: {
        code: 'task_cancelled',
        message:
          reporter.cancelReason ?? 'Task cancelled before pi executor started.',
        retryable: false,
      },
    };
  }

  let reporterOpen = opts.reporterAlreadyOpened ?? false;
  let managed: Awaited<ReturnType<typeof resumeVm>> | null = null;
  let session: AgentSession | null = null;
  // Tracked at function scope so the post-prompt summary block can
  // read the call counter even though the handle is only constructed
  // inside the session-setup `try`. Null means "task type did not
  // opt in to subagents".
  let subagentHandle: SubagentToolHandle | null = null;
  const finalUsage: TaskUsage = emptyUsage(opts.provider, opts.model);
  // Tracked at function scope so `finally` can remove the listener
  // even if we throw before assigning. Null means "no listener wired".
  let cancelListener: (() => void) | null = null;

  const makeFailedOutput = (
    code: string,
    message: string,
    usage: TaskUsage = finalUsage,
  ): TaskOutput => ({
    taskId: task.id,
    attemptN: attemptN,
    status: 'failed',
    output: null,
    outputCid: null,
    usage,
    durationMs: Date.now() - startTime,
    error: { code, message, retryable: false },
  });
  const makeCancelledOutput = (message: string): TaskOutput => ({
    taskId: task.id,
    attemptN: attemptN,
    status: 'cancelled',
    output: null,
    outputCid: null,
    usage: finalUsage,
    durationMs: Date.now() - startTime,
    error: { code: 'task_cancelled', message, retryable: false },
  });

  // Resolve the handler once per task. The factory wins when set so
  // poll-mode callers can bind per-task context (taskId, attemptN);
  // factory throws are caught and downgraded to a stderr line so a
  // misbehaving caller can't sink the executor.
  let onTurnEvent: TurnEventHandler;
  if (opts.makeOnTurnEvent) {
    try {
      onTurnEvent = opts.makeOnTurnEvent(claimedTask);
    } catch (err) {
      process.stderr.write(
        `[emit] makeOnTurnEvent threw: ` +
          `${err instanceof Error ? err.message : String(err)}\n`,
      );
      onTurnEvent = noopTurnEventHandler;
    }
  } else {
    onTurnEvent = opts.onTurnEvent ?? noopTurnEventHandler;
  }
  const emit = async (
    kind: TurnEventKind,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    await emitTaskEvent({
      kind,
      payload,
      onTurnEvent,
      reporter,
      taskId: task.id,
      attemptN,
      log: (message) => {
        process.stderr.write(`${message}\n`);
      },
    });
  };
  const emitError = async (
    phase: string,
    message: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> => {
    await emit('error', { phase, message, ...extra });
  };

  try {
    if (!opts.reporterAlreadyOpened) {
      await reporter.open({ taskId: task.id, attemptN });
    }
    reporterOpen = true;

    // Resolve the snapshot after the reporter has been opened so build
    // failures can surface as task messages instead of only daemon logs.
    let checkpointPath: string;
    try {
      checkpointPath =
        opts.checkpointPath ??
        (opts.resolveCheckpointPath
          ? await opts.resolveCheckpointPath()
          : await ensureSnapshot({
              config: opts.sandboxConfig?.snapshot,
              onProgress:
                opts.onSnapshotProgress ??
                ((m) => {
                  process.stderr.write(`[snapshot] ${m}\n`);
                }),
            }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emitError('snapshot', message);
      return makeFailedOutput('snapshot_failed', message);
    }

    // Resolve the dedicated worktree after the reporter is live so path
    // collisions / git metadata errors also reach the task attempt stream.
    try {
      workspace = prepareTaskWorkspace(task, requestedMountPath, executionPlan);
      mountPath = workspace.mountPath;
      cwdPath = workspace.cwdPath;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emitError('worktree_setup', message);
      return makeFailedOutput('worktree_setup_failed', message);
    }

    try {
      const sandboxConfig = applyExecutionPlanSandboxOverrides(
        opts.sandboxConfig,
        executionPlan,
      );
      managed = await resumeVm({
        checkpointPath,
        agentName: opts.agentName,
        agentRootDir,
        mountPath,
        workspaceMode: workspace.mode,
        extraAllowedHosts: opts.extraAllowedHosts,
        sandboxConfig,
        forwardEnv: opts.forwardEnv,
        signal: reporter.cancelSignal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (reporter.cancelSignal.aborted) {
        await emitError('vm_resume', message, { cancelled: true });
        return makeCancelledOutput(
          reporter.cancelReason ?? 'Task cancelled during VM resume.',
        );
      }
      await emitError('vm_resume', message);
      return makeFailedOutput('vm_resume_failed', message);
    }

    const diaryId = task.diaryId ?? '';
    const taskTeamId = task.teamId ?? '';
    activateAgentEnv(managed.credentials.agentEnv, agentRootDir);
    const activeWorkspace = workspace;
    const activeManaged = managed;
    if (!activeWorkspace) {
      throw new Error('task workspace not prepared');
    }

    await emit('info', {
      event: 'execute_start',
      correlationId: task.correlationId ?? null,
      taskType: task.taskType,
      teamId: task.teamId,
      provider: opts.provider,
      model: opts.model,
      workspaceMode: activeWorkspace.mode,
      workspaceBranch: activeWorkspace.branch,
    });

    // Resolve `freeform.continueFrom` source-attempt material before we
    // build the prompt. The freeform builder renders a "Prior context"
    // section when this is present. Errors are non-fatal — the prompt
    // still assembles without the section. See #1287.
    let resolvedPriorContext: TaskUserPromptContext['priorContext'];
    const continueFrom = (
      task.input as { continueFrom?: ContinueFromPointer } | undefined
    )?.continueFrom;
    if (task.taskType === FREEFORM_TYPE && continueFrom) {
      try {
        const priorAgent = await connect({ configDir: managed.agentDir });
        const resolved = await resolvePriorContext(priorAgent, continueFrom);
        if (resolved) {
          resolvedPriorContext = resolved;
          await emit('info', {
            event: 'prior_context_resolved',
            sourceTaskId: continueFrom.taskId,
            sourceAttemptN: continueFrom.attemptN,
            hasSummary: !!resolved.summary,
            artifactCount: resolved.artifacts?.length ?? 0,
          });
        } else {
          await emit('info', {
            event: 'prior_context_empty',
            sourceTaskId: continueFrom.taskId,
            sourceAttemptN: continueFrom.attemptN,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Non-fatal — agent runs without a Prior context section. The
        // `severity: 'warn'` tag lets observers filter for degraded
        // continuations even though TaskMessageKind only exposes
        // 'info'/'error' at the wire level. Specific event name
        // (`prior_context_resolve_failed`) is the structured filter key.
        await emit('info', {
          event: 'prior_context_resolve_failed',
          severity: 'warn',
          sourceTaskId: continueFrom.taskId,
          sourceAttemptN: continueFrom.attemptN,
          message,
        });
      }
    }

    // Slice 1.5 of #943 — select task/profile context before prompt
    // rendering so builders that mention context availability see the same
    // effective context later delivered to the VM.
    const rawContext = (task.input as { context?: unknown }).context;
    let effectiveRuntimeContext: ContextRef[];
    try {
      effectiveRuntimeContext = resolveEffectiveRuntimeContext({
        rawTaskContext: rawContext,
        runtimeProfileContext: opts.runtimeProfileContext,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emit('error', { message, phase: 'context_resolution' });
      return makeFailedOutput('context_resolution_failed', message);
    }

    let taskPrompt: string;
    try {
      const promptCtx: TaskUserPromptContext = {
        diaryId,
        taskId: task.id,
        workspace: {
          mode: activeWorkspace.mode,
          branch: activeWorkspace.branch,
          attached:
            executionPlan?.workspaceAttachment !== undefined ||
            executionPlan?.workspaceSeed?.source === 'producer',
          source:
            executionPlan?.workspaceSeed?.source === 'producer'
              ? 'producer_copy'
              : executionPlan?.workspaceAttachment !== undefined
                ? 'producer_attachment'
                : undefined,
        },
        extras: opts.promptExtras,
        priorContext: resolvedPriorContext,
        effectiveRuntimeContext,
      };
      const assembled = buildTaskUserPrompt(task, promptCtx);
      taskPrompt = assembled.text;
      // Forward the per-section trace for replay tooling — answers
      // "what did the model actually see, section by section?".
      await emit('info', {
        event: 'prompt_assembled',
        correlationId: task.correlationId ?? null,
        taskType: assembled.taskType,
        sections: assembled.trace,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emit('error', { message, phase: 'prompt_build' });
      return makeFailedOutput('prompt_build_failed', message);
    }

    // Resolve effective runtime context into delivered skill files,
    // system-prompt prefix, and user-message suffix.
    let injectedContext: InjectedRuntimeContext;
    try {
      injectedContext = await injectRuntimeContext({
        context: effectiveRuntimeContext,
        fs: managed.vm.fs,
        guestWorkspace: managed.guestWorkspace,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emit('error', { message, phase: 'context_resolution' });
      return makeFailedOutput('context_resolution_failed', message);
    }

    if (injectedContext.injected.length > 0) {
      await emit('info', {
        event: 'context_injected',
        correlationId: task.correlationId ?? null,
        count: injectedContext.injected.length,
        bindings: injectedContext.injected.map((r) => r.binding),
        slugs: injectedContext.injected.map((r) => r.slug),
      });
    }

    if (injectedContext.userInlineSuffix) {
      taskPrompt = `${taskPrompt}\n\n---\n\n${injectedContext.userInlineSuffix}`;
    }

    // pi's createAgentSession only treats `tools:` as a name-filter; the actual
    // built-in tool implementations are rebuilt from defaults inside the
    // session unless we route them through customTools, which DOES override the
    // default by name at definition-registry merge time (AgentSession._refreshToolRegistry).
    const gondolinCustomTools = createGondolinToolDefinitions({
      vm: managed.vm,
      mountPath,
      guestWorkspace: managed.guestWorkspace,
    });

    // Per-task-type submit-output tool. Captured payload (when the
    // model calls the tool with valid args) becomes the authoritative
    // output. For task types with a registered submit tool, a valid
    // submit call is required to complete the attempt; the legacy
    // parser fallback is only consulted when the task type has no
    // registered output schema (resolveSubmitTools returns null).
    const { handle: submitToolHandle, tools: submitToolDefs } =
      resolveSubmitTools(task.taskType, {
        model: opts.model,
        input: task.input,
        inputCid: task.inputCid,
        maxSubmitValidationRetries: opts.maxSubmitValidationRetries,
      });
    const submitTools: ToolDefinition[] =
      submitToolDefs as unknown as ToolDefinition[];

    try {
      const moltnetAgent = await connect({ configDir: managed.agentDir });
      // Build the host-exec env allowlist: default keys + all agent env keys
      // (MOLTNET_*, GIT_CONFIG_GLOBAL, etc. set by activateAgentEnv).
      const hostExecBaseEnv = new Set([
        ...HOST_EXEC_DEFAULT_BASE_ENV,
        ...Object.keys(managed.credentials.agentEnv),
      ]);
      const moltnetTools = createMoltNetTools({
        getAgent: () => moltnetAgent,
        getDiaryId: () => diaryId,
        getTeamId: () => taskTeamId,
        getSessionErrors: () => [],
        clearSessionErrors: () => {
          /* no-op in headless mode */
        },
        getHostCwd: () => cwdPath,
        openWorkspaceFileForRead: (filePath) =>
          openVmWorkspaceFileForRead({
            vm: activeManaged.vm,
            cwdPath,
            guestWorkspace: activeManaged.guestWorkspace,
            filePath,
          }),
        hostExecBaseEnv,
        hostExecAutoApprove:
          opts.hostExecAutoApprove ??
          opts.sandboxConfig?.hostExec?.autoApprove ??
          false,
        // Daemon path is always inside an active task — wire the task
        // context so moltnet_create_entry forces the task diary and
        // injects provenance tags (issue #979).
        getTaskContext: () => ({
          taskId: task.id,
          taskType: task.taskType,
          attemptN,
          diaryId,
          correlationId: task.correlationId ?? null,
        }),
      });

      // Pi-coding-agent's own env-var convention is
      // `PI_CODING_AGENT_DIR` (see @earendil-works/pi-coding-agent's
      // `config.ts:getAgentDir()`). When the daemon runs in CI, the
      // host's HOME is the runner user's home (e.g. /home/runner) and
      // the action writes auth.json to a runner-temp dir to keep the
      // secret out of `~`. Hard-coding `homedir()/.pi/agent` here
      // overrides that placement and breaks `createAgentSession` with
      // a generic "No API key found for <provider>" before any LLM
      // call. Honor PI_CODING_AGENT_DIR when set; otherwise fall back
      // to the canonical home-rooted path so local `pi /login` flows
      // continue to work unchanged.
      const piAuthDir =
        process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
      const getModelLoose = getModel as unknown as (
        provider: string,
        modelId: string,
      ) => Model<Api>;
      const modelHandle = getModelLoose(opts.provider, opts.model);

      // Daemon-controlled runtime isolation (issue #979 + #943 slice 1.5):
      //  - Runtime-profile prompt context is operator-selected guidance.
      //    Append the immutable kernel after it so context cannot override
      //    credential, sandbox, untrusted-context, or submit-wire rules.
      //  - Empty context is guarded so we do not pass an empty entry to Pi.
      //  - skillsOverride returns ONLY the skills resolved from effective
      //    runtime context (binding: 'skill'). Locally-discovered skills
      //    (`cwd/.pi/skills`, `~/.pi/agent/skills`, …) are discarded so
      //    untrusted local prose never appears as a `<location>` pointer
      //    in the system prompt's `<available_skills>` block.
      const runtimeKernel = buildRuntimeKernel({
        taskId: task.id,
        taskType: task.taskType,
        attemptN,
        diaryId,
        agentName: opts.agentName,
        guestWorkspace: managed.guestWorkspace,
        correlationId: task.correlationId ?? null,
      });
      const appendSystemPrompt = composeRuntimeSystemPrompt({
        profilePromptPrefix: injectedContext.systemPromptPrefix,
        kernel: runtimeKernel,
      });
      const injectedSkills = injectedContext.skills;

      // Subagent custom tool — registered only when the task type opts
      // in via TaskTypeEntry.usesSubagents (#1087). The subagent
      // inherits Gondolin + moltnet_* tools but NOT this task's
      // submit-output tool (different schema) nor the subagent tool
      // itself (no nested delegation in v1).
      const parentSubagentTools: ToolDefinition[] = [];
      if (taskTypeUsesSubagents(task.taskType)) {
        subagentHandle = createSubagentTool({
          mountPath,
          cwdPath,
          piAuthDir,
          modelHandle,
          thinkingLevel: opts.thinkingLevel,
          temperature: opts.temperature,
          topP: opts.topP,
          topK: opts.topK,
          maxOutputTokens: opts.maxOutputTokens,
          agentName: opts.agentName,
          inheritedCustomTools: [...gondolinCustomTools, ...moltnetTools],
          parentRuntimeInstructor: runtimeKernel,
          parentTaskId: task.id,
          parentTaskType: task.taskType,
          parentAttemptN: attemptN,
          contractRegistry: opts.subagentContractRegistry!,
          // Propagate parent cancel (operator cancel + task-level
          // runningTimeoutSec expiry already flow through this signal
          // for the parent session via `wireSessionAbort`) to every
          // in-flight subagent's inner session.abort(). Closes #1090.
          parentCancelSignal: reporter.cancelSignal,
        });
        parentSubagentTools.push(subagentHandle.tool);
      }

      session = await buildAgentSession({
        mountPath,
        cwdPath,
        piAuthDir,
        modelHandle,
        thinkingLevel: opts.thinkingLevel,
        temperature: opts.temperature,
        topP: opts.topP,
        topK: opts.topK,
        maxOutputTokens: opts.maxOutputTokens,
        agentName: opts.agentName,
        customTools: [
          ...gondolinCustomTools,
          ...moltnetTools,
          ...submitTools,
          ...parentSubagentTools,
        ],
        appendSystemPrompt,
        skillsOverride: () => ({ skills: injectedSkills, diagnostics: [] }),
        // MoltNet-specific span attrs only — pi's OTel extension owns
        // gen_ai.* keys and filters anything we pass that collides.
        otelSpanAttrs: {
          'moltnet.task.id': task.id,
          'moltnet.task.attempt': attemptN,
          'moltnet.task.type': task.taskType,
        },
        sessionPersistence: executionPlan?.sessionPersistence ?? undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emit('error', { message, phase: 'session_setup' });
      return makeFailedOutput('session_setup_failed', message);
    }

    // Per-attempt scalars accumulated by the session event handler
    // (assistantText, llmAbort, llmErrorMessage, turn/bash-timeout counters).
    // The diagnostic pi attaches to the final error turn flows into
    // `turnState.llmErrorMessage` so operators see things like
    // "Model 'gpt-5.4-codex' not found in registry" instead of the generic
    // 'LLM API error during turn'.
    const turnState = createSessionTurnState();
    // reporterError carries a `retryable` flag (a reporter buffer/heartbeat
    // failure is transient, #1538) that flows through to the attempt result.
    let reporterError: {
      code: string;
      message: string;
      retryable?: boolean;
    } | null = null;
    const usage: TaskUsage = finalUsage;

    // Cap-driven abort state. See `triggerCapAbort` below.
    let capAbort: { code: string; message: string } | null = null;
    const maxTurns = opts.maxTurns ?? 0;
    const maxBashTimeouts = opts.maxBashTimeouts ?? 3;

    // Wire reporter.cancelSignal → session.abort() so the LLM session
    // tears down promptly when the proposer cancels mid-prompt. Tracked
    // via `cancelListener` at function scope so `finally` can remove it
    // even if we throw.
    cancelListener = wireSessionAbort(reporter.cancelSignal, session);
    const recordingPromise: Promise<void>[] = [];
    const track = (p: Promise<void>) => {
      recordingPromise.push(
        p.catch((err: unknown) => {
          if (!reporterError) {
            const message = err instanceof Error ? err.message : String(err);
            reporterError = {
              code: 'reporter_failed',
              message,
              retryable: true,
            };
            process.stderr.write(`[reporter] ${message}\n`);
          }
        }),
      );
    };

    // Snapshot `session` into a non-null local so the cap-abort closure
    // doesn't have to assert; by the time this point is reached the
    // success path has assigned the session (failure returned earlier).
    const liveSession = session;

    // Trigger a cap abort idempotently. The pi session will emit a final
    // `turn_end` with `stopReason: 'aborted'` in response; we silently
    // ignore that turn_end (no llmAbort flip) and surface the cap reason
    // in finalization. `cancelled` (proposer-driven) and `capAbort`
    // (executor-driven) are distinct paths; both call session.abort()
    // but the finalization picks the right error code.
    const triggerCapAbort = (code: string, message: string): void => {
      if (capAbort) return;
      capAbort = { code, message };
      liveSession.abort().catch((err: unknown) => {
        const m = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[cap] session.abort() failed: ${m}\n`);
      });
      track(emit('info', { event: 'cap_abort', code, message }));
    };

    session.subscribe(
      makeSessionEventHandler({
        state: turnState,
        usage,
        maxTurns,
        maxBashTimeouts,
        emit,
        emitError,
        track,
        triggerCapAbort,
      }),
    );

    let runError: { code: string; message: string } | null = null;
    // One provider-error-tolerant prompt pass. Reused for both the initial
    // task prompt and each submit-missing re-prompt so every pass inherits
    // the same provider-retry / cancel / cap handling.
    const runPrompt = (promptText: string) =>
      promptWithProviderErrorRetries({
        session: liveSession,
        initialPrompt: promptText,
        cancelSignal: reporter.cancelSignal,
        isCapAborted: () => capAbort !== null,
        getProviderErrorState: () => ({
          llmAbort: turnState.llmAbort,
          llmErrorMessage: turnState.llmErrorMessage,
        }),
        maxRetries: opts.maxProviderErrorRetries ?? 2,
        baseDelayMs: opts.providerErrorRetryBaseDelayMs ?? 2_000,
        maxDelayMs: opts.providerErrorRetryMaxDelayMs ?? 30_000,
        retryPrompt: opts.providerErrorRetryPrompt ?? 'Go on',
        onRetry: async (event) => {
          await emit('info', event);
          await notifyProviderErrorRetryUi(opts.providerErrorRetryUi, event);
        },
        onPromptError: (message) =>
          emit('error', { message, phase: 'session_prompt' }),
      });
    const submitMissingConfig = resolveSubmitMissingConfig({
      submitToolHandle,
      maxSubmitMissingReprompts: opts.maxSubmitMissingReprompts,
      submitMissingPrompt: opts.submitMissingPrompt,
    });
    const promptResult = await promptUntilSubmitted({
      runPrompt,
      initialPrompt: taskPrompt,
      submitMissingPrompt: submitMissingConfig.submitMissingPrompt,
      maxSubmitMissingReprompts: submitMissingConfig.maxSubmitMissingReprompts,
      getSubmitState: submitMissingConfig.getSubmitState,
      isStopped: () =>
        submitRepromptStopped({
          cancelled: reporter.cancelSignal.aborted,
          capAborted: capAbort !== null,
          llmAbort: turnState.llmAbort,
        }),
      onSubmitReprompt: async (event) => {
        await emit('info', event);
      },
    });
    runError = promptResult.runError;
    // Surface how many submit-missing nudges this attempt needed (0 when the
    // model submitted on the first pass). Stream-visible counterpart to the
    // `output_missing` OTel counter recorded below when recovery fails.
    if (promptResult.submitReprompts > 0) {
      await emit('info', {
        event: 'submit_missing_summary',
        submitReprompts: promptResult.submitReprompts,
        captured: submitToolHandle
          ? submitToolHandle.getCaptured() !== null
          : false,
      });
    }

    // Emit a single summary line per task attempt that used the
    // subagent tool. Useful for spotting parents that delegate
    // unexpectedly often (or never delegate when they should). The
    // call count is the only state on the handle; we don't track
    // per-call failure rates here because each subagent invocation
    // already emits its own OTel span via the inner session's
    // piOtelExtension.
    if (subagentHandle && subagentHandle.getCallCount() > 0) {
      await emit('info', {
        event: 'subagent_summary',
        callCount: subagentHandle.getCallCount(),
      });
    }

    await Promise.all(recordingPromise);

    // Cancellation takes precedence over runError / parseError.
    // pi maps `session.abort()` to a `turn_end` with `stopReason: 'aborted'`;
    // the subscribe handler does NOT set `llmAbort` for that stop reason
    // (only `'error'`), so the cancelSignal check here is the sole
    // mechanism that distinguishes a cancel-driven stop from a clean
    // finish. This also covers the case where the executor finished
    // mid-flight before the signal had a chance to abort the session —
    // usage tokens accumulated up to that point are preserved.
    const cancelled = reporter.cancelSignal.aborted;

    let parsedOutput: Record<string, unknown> | null = null;
    let parsedOutputCid: string | null = null;
    let parseError: { code: string; message: string } | null = null;
    if (!runError && !turnState.llmAbort && !cancelled && !capAbort) {
      const captured = await captureAttemptOutput({
        taskType: task.taskType,
        model: opts.model,
        input: task.input,
        inputCid: task.inputCid,
        assistantText: turnState.assistantText,
        submitToolHandle,
        emit,
      });
      parsedOutput = captured.output;
      parsedOutputCid = captured.outputCid;
      parseError = captured.error;
      if (parsedOutput && !parseError) {
        const materialized = await materializeCapturedAttemptOutput({
          taskType: task.taskType,
          submission: parsedOutput,
          input: task.input,
          inputCid: task.inputCid,
          usage,
          durationMs: Date.now() - startTime,
          traceparent: claimedTask.traceHeaders.traceparent,
          model: opts.model,
          emit,
        });
        parsedOutput = materialized.output;
        parsedOutputCid = materialized.outputCid;
        parseError = materialized.error;
      }
    }

    if (cancelled) {
      return {
        taskId: task.id,
        attemptN: attemptN,
        status: 'cancelled',
        output: null,
        outputCid: null,
        usage,
        durationMs: Date.now() - startTime,
        error: {
          code: 'task_cancelled',
          message:
            reporter.cancelReason ??
            'Task cancelled by proposer while pi session was running.',
          retryable: false,
        },
      };
    }

    // Cap-driven abort: distinct from proposer cancel. Failed status
    // (the task didn't complete its work), but with a specific error
    // code so the proposer can decide whether to retry with a higher cap.
    // Cast back to the union: TS narrows `capAbort` to `null` in the
    // parent scope because it doesn't follow the closure mutation
    // inside `triggerCapAbort`. The cast restores the full union so
    // the truthy check can narrow correctly.
    const capAbortSnapshot = capAbort as {
      code: string;
      message: string;
    } | null;
    if (capAbortSnapshot) {
      return {
        taskId: task.id,
        attemptN: attemptN,
        status: 'failed',
        output: null,
        outputCid: null,
        usage,
        durationMs: Date.now() - startTime,
        error: {
          code: capAbortSnapshot.code,
          message: capAbortSnapshot.message,
          retryable: false,
        },
      };
    }

    return buildAttemptResult({
      taskId: task.id,
      attemptN,
      output: parsedOutput,
      outputCid: parsedOutputCid,
      usage,
      durationMs: Date.now() - startTime,
      runError,
      parseError,
      reporterError,
      llmAbort: turnState.llmAbort,
      llmErrorMessage: turnState.llmErrorMessage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeFailedOutput('executor_unexpected_error', message);
  } finally {
    await cleanupAttempt({
      cancelSignal: reporter.cancelSignal,
      cancelListener,
      session,
      reporterOpen,
      reporter,
      finalUsage,
      managed,
      workspace,
      taskId: task.id,
      attemptN,
    });
  }
}

/** Event delivered to an `AgentSession` subscriber. */
export type SessionSubscribeEvent = Parameters<
  Parameters<AgentSession['subscribe']>[0]
>[0];

/**
 * Mutable per-attempt scalars accumulated by the session event handler. Held
 * in an object (not bare `let`s) so the handler can be extracted from
 * `executePiTask` and unit-tested while still mutating shared attempt state.
 */
export interface SessionTurnState {
  /** Streamed assistant text, concatenated across `text_delta` events. */
  assistantText: string;
  /** Final turn ended with `stopReason: 'error'` (last-turn-wins). */
  llmAbort: boolean;
  /** Provider diagnostic from the final error turn, else null. */
  llmErrorMessage: string | null;
  /** Tool-use turns seen (drives the max-turns cap). */
  toolUseTurnCount: number;
  /** Bash timeouts seen this attempt (drives the max-bash-timeouts cap). */
  bashTimeoutCount: number;
}

export function createSessionTurnState(): SessionTurnState {
  return {
    assistantText: '',
    llmAbort: false,
    llmErrorMessage: null,
    toolUseTurnCount: 0,
    bashTimeoutCount: 0,
  };
}

export interface SessionEventHandlerDeps {
  state: SessionTurnState;
  /** Accumulated token usage, mutated in place across turn_end events. */
  usage: TaskUsage;
  /** Tool-use-turn cap (0 = disabled). */
  maxTurns: number;
  /** Bash-timeout cap (0 = disabled). */
  maxBashTimeouts: number;
  emit: (
    kind: TurnEventKind,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  emitError: (
    phase: string,
    message: string,
    extra?: Record<string, unknown>,
  ) => Promise<void>;
  /** Fire-and-forget tracker for reporter writes (collects rejections). */
  track: (p: Promise<void>) => void;
  /** Idempotent cap-abort trigger (aborts the live session). */
  triggerCapAbort: (code: string, message: string) => void;
}

/**
 * Build the `AgentSession.subscribe` handler for one attempt: bridges pi
 * events to the reporter, accumulates token usage and assistant text, and
 * enforces the bash-timeout and tool-use-turn caps. Extracted from
 * `executePiTask` so this dense, branch-heavy logic is unit-tested against a
 * scripted event stream instead of only through a booted VM.
 *
 * The handler mutates `deps.state` and `deps.usage` in place; the caller reads
 * them after `session.prompt()` resolves (by which point `state.llmAbort`
 * holds the terminal turn's outcome — see the "last-turn wins" note below).
 *
 * @internal Exported for unit testing; not part of the package's public API.
 */
export function makeSessionEventHandler(
  deps: SessionEventHandlerDeps,
): (event: SessionSubscribeEvent) => void {
  const {
    state,
    usage,
    maxTurns,
    maxBashTimeouts,
    emit,
    emitError,
    track,
    triggerCapAbort,
  } = deps;
  return (event) => {
    if (event.type === 'message_update') {
      const ae = event.assistantMessageEvent;
      if (ae.type === 'text_delta') {
        state.assistantText += ae.delta;
        track(emit('text_delta', { delta: ae.delta }));
      }
    } else if (event.type === 'tool_execution_start') {
      track(emit('tool_call_start', { tool_name: event.toolName }));
    } else if (event.type === 'tool_execution_end') {
      track(
        emit('tool_call_end', {
          tool_name: event.toolName,
          is_error: event.isError,
          result: event.isError ? truncateForWire(event.result) : undefined,
        }),
      );
      if (shouldEmitToolCallError(event)) {
        track(
          emitError('tool_call_error', describeToolErrorMessage(event.result), {
            tool: event.toolName,
            result: truncateForWire(event.result),
          }),
        );
      }
      // Bash-timeout cap. pi's bash tool wraps timeout errors with the
      // text "Command timed out after <N> seconds" (see
      // @earendil-works/pi-coding-agent's bash.js error path). We
      // detect the substring in the structured tool result content.
      // Total across the attempt (not consecutive) — different
      // commands timing out is still a death-spiral pattern.
      if (
        maxBashTimeouts > 0 &&
        event.toolName === 'bash' &&
        event.isError &&
        isBashTimeoutResult(event.result)
      ) {
        state.bashTimeoutCount += 1;
        if (state.bashTimeoutCount >= maxBashTimeouts) {
          triggerCapAbort(
            'max_bash_timeouts_exceeded',
            `Aborted after ${state.bashTimeoutCount} bash timeouts in this attempt (cap ${maxBashTimeouts}).`,
          );
        }
      }
    } else if (event.type === 'turn_end') {
      const msg = event.message as {
        role?: string;
        stopReason?: string;
        // pi-coding-agent attaches a human-readable diagnostic to the
        // final assistant message when stopReason === 'error'. See
        // @earendil-works/pi-coding-agent's `AssistantMessage`.
        // Capturing it here is the only way to propagate the
        // underlying provider error (model-not-registered, 401, rate
        // limit, …) up to the task's `error.message` instead of the
        // generic 'LLM API error during turn'.
        errorMessage?: string;
        usage?: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
        };
      };
      if (msg?.role === 'assistant' && msg.usage) {
        usage.inputTokens += Math.max(0, msg.usage.input ?? 0);
        usage.outputTokens += Math.max(0, msg.usage.output ?? 0);
        const cr = Math.max(0, msg.usage.cacheRead ?? 0);
        const cw = Math.max(0, msg.usage.cacheWrite ?? 0);
        if (cr) usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + cr;
        if (cw) usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + cw;
      }
      const stopReason = msg?.stopReason ?? 'end_turn';
      track(emit('turn_end', { stop_reason: stopReason }));
      // Tool-use turn counter for the max-turns cap. Anthropic SDK
      // semantics: count only tool-use turns (any turn whose
      // stopReason !== 'end_turn'). The final text-only response
      // does not consume a turn. 'aborted' turns (from our own
      // session.abort, or proposer cancel) are also excluded; they
      // don't represent forward progress against the cap.
      if (
        maxTurns > 0 &&
        stopReason !== 'end_turn' &&
        stopReason !== 'aborted' &&
        stopReason !== 'error'
      ) {
        state.toolUseTurnCount += 1;
        if (state.toolUseTurnCount >= maxTurns) {
          triggerCapAbort(
            'max_turns_exceeded',
            `Aborted after ${state.toolUseTurnCount} tool-use turns (cap ${maxTurns}).`,
          );
        }
      }
      // Reflect ONLY the final turn's stop reason. pi emits turn_end per
      // assistant turn; a transient error in an earlier turn that pi then
      // recovers from (next turn completes cleanly) must not fail the task.
      // session.prompt() resolves after the final turn, so by the time we
      // read llmAbort below it holds the terminal state.
      state.llmAbort = msg?.stopReason === 'error';
      // Mirror the same "last-turn wins" rule for the error message:
      // overwrite on each error turn, clear on a recovered turn so a
      // transient earlier failure doesn't bleed into the final result.
      if (msg?.stopReason === 'error') {
        state.llmErrorMessage =
          typeof msg.errorMessage === 'string' && msg.errorMessage.length > 0
            ? msg.errorMessage
            : null;
      } else {
        state.llmErrorMessage = null;
      }
    }
  };
}

export interface CaptureAttemptOutputDeps {
  taskType: string;
  model?: string;
  /** Original task input, threaded to the parser path for cross-field rules. */
  input: unknown;
  /** Canonical CID of input, used to validate an authored verification. */
  inputCid?: string;
  /** Streamed assistant text, used only by the legacy parser fallback. */
  assistantText: string;
  /** Submit-output handle, or null for task types with no registered schema. */
  submitToolHandle: Pick<
    SubmitOutputToolHandle,
    'getCaptured' | 'getExhaustedValidationFailure'
  > | null;
  emit: (
    kind: TurnEventKind,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}

export interface MaterializeCapturedAttemptOutputDeps {
  taskType: string;
  submission: Record<string, unknown>;
  input: unknown;
  inputCid: string;
  usage: TaskUsage;
  durationMs: number;
  traceparent?: string;
  model?: string;
  emit: (
    kind: TurnEventKind,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}

/**
 * Convert a model-approved submission into durable task output. This is where
 * executor-observed fields become part of a task result; the model never gets
 * a chance to fabricate them through its submit tool.
 */
export async function materializeCapturedAttemptOutput(
  deps: MaterializeCapturedAttemptOutputDeps,
): Promise<ParsedTaskOutputResult> {
  if (deps.usage.inputTokens === 0 && deps.usage.outputTokens === 0) {
    recordTaskOutputTelemetryAnomaly({
      taskType: deps.taskType,
      model: deps.model,
      kind: 'zero_usage',
    });
  }
  if (deps.durationMs === 0) {
    recordTaskOutputTelemetryAnomaly({
      taskType: deps.taskType,
      model: deps.model,
      kind: 'zero_duration',
    });
  }
  const durableOutput = materializeTaskOutput(deps.taskType, deps.submission, {
    usage: deps.usage,
    durationMs: deps.durationMs,
    traceparent: deps.traceparent,
  });
  const errors = validateTaskOutput(deps.taskType, durableOutput, deps.input, {
    inputCid: deps.inputCid,
  });
  if (errors.length > 0) {
    const error = {
      code: 'output_validation_failed',
      message:
        'Materialized output failed schema validation: ' +
        errors
          .slice(0, 3)
          .map((item) => `${item.field}: ${item.message}`)
          .join('; '),
    };
    recordTaskOutputParseResult({
      taskType: deps.taskType,
      model: deps.model,
      code: 'output_validation_failed',
    });
    await deps.emit('error', {
      message: error.message,
      phase: 'output_validation',
    });
    return { output: null, outputCid: null, error };
  }

  try {
    return {
      output: durableOutput,
      outputCid: await computeJsonCid(durableOutput),
      error: null,
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const error = {
      code: 'output_cid_compute_failed',
      message: `Materialized output could not be canonicalized: ${message}`,
    };
    recordTaskOutputParseResult({
      taskType: deps.taskType,
      model: deps.model,
      code: 'output_cid_compute_failed',
    });
    await deps.emit('error', {
      message: error.message,
      phase: 'output_validation',
    });
    return { output: null, outputCid: null, error };
  }
}

// Same shape the parser path already returns; alias it so the submit-tool
// and parser branches can't drift.
export type CapturedAttemptOutput = ParsedTaskOutputResult;

/**
 * Resolve the attempt's structured output once the session has finished
 * cleanly (no run error / provider abort / cancel / cap). Three mutually
 * exclusive paths, in precedence order:
 *
 *   1. Submit tool captured a payload → trust it, compute its CID. A
 *      canonicalization failure becomes `output_cid_compute_failed`.
 *   2. Submit tool registered but nothing captured → the exhausted-validation
 *      failure wins if present, else `submit_output_missing` (recording the
 *      `output_missing` counter so the never-called path is observable).
 *   3. No submit tool (legacy task type) → parse the trailing assistant text.
 *
 * Extracted from `executePiTask` so this precedence — the part a refactor is
 * most likely to silently reorder — is unit-tested directly. The caller
 * still owns the guard deciding whether output capture runs at all.
 *
 * @internal Exported for unit testing; not part of the package's public API.
 */
export async function captureAttemptOutput(
  deps: CaptureAttemptOutputDeps,
): Promise<CapturedAttemptOutput> {
  const {
    taskType,
    model,
    input,
    inputCid,
    assistantText,
    submitToolHandle,
    emit,
  } = deps;
  // Prefer the submit-tool's captured payload over the parser path.
  // The submit-tool already validated args against the task type's
  // output schema; if the model called it successfully we trust the
  // captured value and skip parsing the trailing assistant text.
  const captured = submitToolHandle?.getCaptured() ?? null;
  if (captured) {
    try {
      const outputCid = await computeJsonCid(captured);
      recordTaskOutputParseResult({
        taskType,
        model,
        code: 'captured_via_tool',
      });
      return { output: captured, outputCid, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const error = {
        code: 'output_cid_compute_failed',
        message: `Captured submit-tool output could not be canonicalized: ${message}`,
      };
      recordTaskOutputParseResult({
        taskType,
        model,
        code: 'output_cid_compute_failed',
      });
      await emit('error', {
        message: error.message,
        phase: 'output_validation',
      });
      return { output: null, outputCid: null, error };
    }
  }

  if (submitToolHandle) {
    const exhausted = submitToolHandle.getExhaustedValidationFailure();
    const error = exhausted ?? {
      code: 'submit_output_missing',
      message:
        'Agent did not satisfy the promised submit-output criterion: ' +
        'no valid task submit tool call was captured before the session ended.',
    };
    // The invalid-args path already records `output_validation_failed`
    // from inside the submit tool. The pure never-called path has no such
    // record, so count it here (dimensioned by model) — otherwise
    // submit-missing failures are invisible to the parse-result counter.
    if (!exhausted) {
      recordTaskOutputParseResult({ taskType, model, code: 'output_missing' });
    }
    await emit('error', { message: error.message, phase: 'output_validation' });
    return { output: null, outputCid: null, error };
  }

  const parsed = await parseStructuredTaskOutput(assistantText, taskType, {
    model,
    input,
    inputCid,
  });
  if (parsed.error) {
    await emit('error', {
      message: parsed.error.message,
      phase: 'output_validation',
    });
  }
  return {
    output: parsed.output,
    outputCid: parsed.outputCid,
    error: parsed.error,
  };
}

export interface BuildAttemptResultArgs {
  taskId: string;
  attemptN: number;
  output: Record<string, unknown> | null;
  outputCid: string | null;
  usage: TaskUsage;
  durationMs: number;
  runError: { code: string; message: string } | null;
  parseError: { code: string; message: string } | null;
  // A reporter (buffer/heartbeat) failure is transient, so it carries a
  // `retryable` flag that survives to the surfaced error (#1538).
  reporterError: { code: string; message: string; retryable?: boolean } | null;
  llmAbort: boolean;
  llmErrorMessage: string | null;
}

/**
 * Assemble the terminal `TaskOutput` for a clean-or-failed finish (cancel and
 * cap aborts are handled by the caller's earlier returns). Encapsulates the
 * failure-precedence ladder — runError → parseError → reporterError →
 * provider abort — so the ordering is unit-tested rather than buried in the
 * orchestrator. A provider abort with no captured diagnostic falls back to a
 * generic message.
 *
 * Errors are non-retryable EXCEPT a reporterError that both wins the ladder
 * and set `retryable: true` (a transient reporter failure, #1538).
 *
 * @internal Exported for unit testing; not part of the package's public API.
 */
export function buildAttemptResult(args: BuildAttemptResultArgs): TaskOutput {
  const status: TaskOutput['status'] =
    args.runError || args.llmAbort || args.parseError || args.reporterError
      ? 'failed'
      : 'completed';
  const errorCode =
    args.runError?.code ??
    args.parseError?.code ??
    args.reporterError?.code ??
    (args.llmAbort ? 'llm_api_error' : undefined);
  const errorMessage =
    args.runError?.message ??
    args.parseError?.message ??
    args.reporterError?.message ??
    (args.llmAbort
      ? // Prefer the diagnostic pi captured on the assistant message
        // over the generic fallback. Most provider failures (model
        // not in registry, auth errors, rate limits, …) surface here
        // with the exact reason; without it operators have no way
        // to distinguish "wrong model id" from "expired token" from
        // "rate limited" without re-running locally.
        (args.llmErrorMessage ?? 'LLM API error during turn')
      : undefined);
  // Only the reporterError propagates retryability, and only when it is the
  // error actually surfaced (runError/parseError take precedence above).
  const errorRetryable =
    args.reporterError &&
    errorCode === args.reporterError.code &&
    errorMessage === args.reporterError.message
      ? (args.reporterError.retryable ?? false)
      : false;

  return {
    taskId: args.taskId,
    attemptN: args.attemptN,
    status,
    output: args.output,
    outputCid: args.outputCid,
    usage: args.usage,
    durationMs: args.durationMs,
    ...(errorCode && errorMessage
      ? {
          error: {
            code: errorCode,
            message: errorMessage,
            retryable: errorRetryable,
          },
        }
      : {}),
  };
}

export interface CleanupAttemptDeps {
  cancelSignal: AbortSignal;
  cancelListener: (() => void) | null;
  session: Pick<AgentSession, 'dispose'> | null;
  /** Whether the reporter was opened (finalize/close only run if so). */
  reporterOpen: boolean;
  reporter: Pick<TaskReporter, 'finalize' | 'close'>;
  finalUsage: TaskUsage;
  // `managed`/`workspace` are the inferred returns of resumeVm /
  // prepareTaskWorkspace, which carry more than teardown needs and have no
  // named alias to `Pick` from — so an inline subset is used for them.
  managed: { vm: { close: () => Promise<void> } } | null;
  workspace: { cleanup: () => void } | null;
  taskId: string;
  attemptN: number;
  /** Sink for swallowed-failure diagnostics. Defaults to `console.error`. */
  logError?: (message: string) => void;
}

/**
 * Tear down one attempt's resources, in order: detach the cancel listener →
 * dispose the pi session → finalize+close the reporter → close the VM →
 * clean the workspace. Extracted from `executePiTask`'s `finally` so the
 * swallow-vs-log-vs-propagate policy is pinned by tests.
 *
 * Failure handling is deliberately asymmetric and preserved exactly:
 * `session.dispose()` throws are silently swallowed; reporter finalize/close
 * and workspace cleanup failures are logged but non-fatal (the task is about
 * to be reported anyway). `vm.close()` is the one teardown error allowed to
 * propagate: a leaked VM means a live microVM the host never reclaims, so its
 * failure must surface loudly rather than be logged and forgotten.
 *
 * @internal Exported for unit testing; not part of the package's public API.
 */
export async function cleanupAttempt(deps: CleanupAttemptDeps): Promise<void> {
  const log = deps.logError ?? ((m: string) => console.error(m));
  // Remove the cancel listener before disposing the session so it can't fire
  // after `dispose()` has torn the session down. `once` makes this redundant
  // when the listener already fired, but removeEventListener is a no-op then.
  if (deps.cancelListener) {
    deps.cancelSignal.removeEventListener('abort', deps.cancelListener);
  }
  if (deps.session) {
    try {
      deps.session.dispose();
    } catch {
      /* swallow */
    }
  }
  if (deps.reporterOpen) {
    try {
      await deps.reporter.finalize(deps.finalUsage);
    } catch (err) {
      // finalize() drains the reporter's buffer, so a failure here means
      // buffered messages were lost or a retry restored them to the buffer —
      // either way the task is about to be marked complete. Log so the loss
      // is visible in the worker log instead of hidden inside an empty catch.
      const detail = err instanceof Error ? err.message : String(err);
      log(
        `executePiTask: reporter.finalize() failed for task ${deps.taskId} ` +
          `attempt ${deps.attemptN}: ${detail}`,
      );
    }
    try {
      await deps.reporter.close();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log(
        `executePiTask: reporter.close() failed for task ${deps.taskId} ` +
          `attempt ${deps.attemptN}: ${detail}`,
      );
    }
  }
  if (deps.managed) {
    await deps.managed.vm.close();
  }
  if (deps.workspace) {
    try {
      deps.workspace.cleanup();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log(
        `executePiTask: workspace cleanup failed for task ${deps.taskId} ` +
          `attempt ${deps.attemptN}: ${detail}`,
      );
    }
  }
}

function applyExecutionPlanSandboxOverrides(
  sandboxConfig: SandboxConfig | undefined,
  executionPlan: Awaited<
    ReturnType<NonNullable<ExecutePiTaskOptions['makeExecutionPlan']>>
  >,
): SandboxConfig | undefined {
  const shadowWrites = executionPlan?.workspaceAttachment?.shadowWrites;
  if (!shadowWrites) {
    return sandboxConfig;
  }

  return {
    ...sandboxConfig,
    vfs: {
      ...sandboxConfig?.vfs,
      shadow: ['**'],
      shadowMode: shadowWrites,
    },
  };
}

function emptyUsage(provider: string, model: string): TaskUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    provider,
    model,
  };
}

/**
 * Wire `cancelSignal` → `session.abort()`. Returns the listener so the
 * caller can remove it on cleanup. If the signal is already aborted at
 * call time (cancel landed between session creation and wiring), fires
 * abort synchronously instead of waiting for an `'abort'` event that
 * already happened.
 *
 * Exported for unit testing without a booted Gondolin VM. The double-
 * invocation guard handles both the rare "fire from constructor + later
 * event" race and the (in-practice idempotent) double-call into
 * `session.abort()`.
 */
export function wireSessionAbort(
  cancelSignal: AbortSignal,
  session: { abort: () => Promise<void> },
): () => void {
  let abortInvoked = false;
  const listener = () => {
    if (abortInvoked) return;
    abortInvoked = true;
    // Fire-and-forget: the executor awaits session.prompt() which is the
    // natural sync point — abort propagates through the LLM stream and
    // resolves prompt(). Adding a tracked promise here would just create
    // another await ladder.
    session.abort().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[pi] session.abort() failed: ${message}\n`);
    });
  };
  if (cancelSignal.aborted) {
    listener();
  } else {
    cancelSignal.addEventListener('abort', listener, { once: true });
  }
  return listener;
}

/**
 * Cap oversized tool-result payloads before embedding them in a
 * `task_messages.payload` row. Bodies above 4 KiB are replaced with a
 * `{ truncated, original_size }` marker so the JSONL/DB size stays bounded.
 */
/**
 * Classify a `tool_execution_end` event for telemetry purposes.
 *
 * Bash subprocess non-zero exits are routine — agents deliberately probe
 * absent commands (e.g. `command -v docker` returning 127) and treat the
 * non-zero exit as data. Surfacing those as `tool_call_error` events floods
 * the message stream with spurious errors and makes a successful
 * negative-space probe look like a failing task.
 *
 * Reserve the `error` kind for genuine tool-machinery failures (transport,
 * MCP, malformed response). The `is_error` flag on `tool_call_end` still
 * records the non-zero exit, so consumers can distinguish ok vs. failed
 * bash calls without searching for a sibling error event.
 *
 * Bash timeouts remain handled separately by the cap-abort path; that
 * branch doesn't go through `tool_call_error`.
 */
export function shouldEmitToolCallError(event: {
  toolName: string;
  isError: boolean;
}): boolean {
  if (!event.isError) return false;
  if (event.toolName === 'bash') return false;
  return true;
}

const PROVIDER_ERROR_NON_RETRYABLE_PATTERNS = [
  /\b401\b/i,
  /\b403\b/i,
  /\bunauthori[sz]ed\b/i,
  /\bforbidden\b/i,
  /\binvalid (?:api )?key\b/i,
  /\bmissing credentials?\b/i,
  /\binsufficient[_\s-]?quota\b/i,
  /\bbilling\b/i,
  /\bmodel .*not (?:found|registered|available)\b/i,
  /\bunknown model\b/i,
];

const PROVIDER_ERROR_RETRYABLE_PATTERNS = [
  /\b429\b/i,
  /\b5(?:02|03|04)\b/i,
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\brate limit/i,
  /\btemporar(?:y|ily)\b/i,
  /\bunavailable\b/i,
  /\boverloaded\b/i,
  /\bECONNRESET\b/i,
  /\bECONNREFUSED\b/i,
  /\bETIMEDOUT\b/i,
  /\bENOTFOUND\b/i,
  /\bEAI_AGAIN\b/i,
  /\bDNS\b/i,
];

export function shouldRetryProviderErrorMessage(
  message: string | null | undefined,
): boolean {
  if (!message || !message.trim()) return true;
  if (
    PROVIDER_ERROR_NON_RETRYABLE_PATTERNS.some((pattern) =>
      pattern.test(message),
    )
  ) {
    return false;
  }
  if (
    PROVIDER_ERROR_RETRYABLE_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return true;
  }
  // Pi's `stopReason: "error"` is itself provider-error metadata. If the
  // diagnostic is unfamiliar but not a known config/auth failure, prefer one
  // same-session continuation over failing the whole attempt immediately.
  return true;
}

export function computeProviderErrorRetryDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  return Math.min(
    Math.max(0, baseDelayMs) * 2 ** (attempt - 1),
    Math.max(0, maxDelayMs),
  );
}

export function formatProviderErrorRetryStatus(
  event: ProviderErrorRetryEvent,
): string {
  const seconds = Math.ceil(event.delayMs / 1_000);
  return `Provider retry ${event.retry}/${event.maxRetries} in ${seconds}s`;
}

export function formatProviderErrorRetryNotification(
  event: ProviderErrorRetryEvent,
): string {
  return `Provider error; retrying same Pi session (${event.retry}/${event.maxRetries}).`;
}

export async function notifyProviderErrorRetryUi(
  ui: ProviderErrorRetryUi | undefined,
  event: ProviderErrorRetryEvent,
): Promise<void> {
  if (!ui || ui.hasUI === false) return;
  await ui.setStatus?.('provider_retry', formatProviderErrorRetryStatus(event));
  await ui.notify?.(formatProviderErrorRetryNotification(event), 'warning');
}

export interface PromptWithProviderErrorRetriesArgs {
  session: Pick<AgentSession, 'prompt'>;
  initialPrompt: string;
  cancelSignal: AbortSignal;
  isCapAborted?: () => boolean;
  getProviderErrorState: () => {
    llmAbort: boolean;
    llmErrorMessage: string | null;
  };
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryPrompt: string;
  onRetry?: (event: ProviderErrorRetryEvent) => Promise<void>;
  onPromptError?: (message: string) => Promise<void>;
}

export async function promptWithProviderErrorRetries(
  args: PromptWithProviderErrorRetriesArgs,
): Promise<{
  runError: { code: string; message: string } | null;
  retryCount: number;
}> {
  let retryCount = 0;
  let promptText = args.initialPrompt;
  while (true) {
    try {
      await args.session.prompt(promptText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await args.onPromptError?.(message);
      return {
        runError: { code: 'session_prompt_failed', message },
        retryCount,
      };
    }

    const { llmAbort, llmErrorMessage } = args.getProviderErrorState();
    if (
      !llmAbort ||
      args.cancelSignal.aborted ||
      args.isCapAborted?.() ||
      retryCount >= args.maxRetries ||
      !shouldRetryProviderErrorMessage(llmErrorMessage)
    ) {
      return { runError: null, retryCount };
    }

    retryCount += 1;
    const delayMs = computeProviderErrorRetryDelay(
      retryCount,
      args.baseDelayMs,
      args.maxDelayMs,
    );
    await args.onRetry?.({
      event: 'provider_error_retry',
      retry: retryCount,
      maxRetries: args.maxRetries,
      delayMs,
      reason: sanitizeProviderErrorRetryReason(llmErrorMessage),
    });
    await sleepUnlessAborted(delayMs, args.cancelSignal);
    if (args.cancelSignal.aborted || args.isCapAborted?.()) {
      return { runError: null, retryCount };
    }
    promptText = args.retryPrompt;
  }
}

/**
 * Continuation prompt used to recover a session that ended without calling
 * the submit-output tool. Names the exact tool and forbids a prose reply so a
 * model that "answered" in text is pushed to actually emit the tool call.
 */
export function buildSubmitMissingPrompt(toolName: string): string {
  return (
    `You ended your turn but did not call the required \`${toolName}\` tool, ` +
    'so no output was captured and the task is not yet complete. ' +
    `Call \`${toolName}\` now with the final structured output exactly as ` +
    "described by that tool's agent submission schema. Do not reply with prose, a summary, or an " +
    'apology — the only way to finish is to call the tool.'
  );
}

/** Snapshot of the submit-output gate read between prompt passes. */
export interface SubmitGateState {
  /** A valid submit-tool call captured a payload. */
  captured: boolean;
  /** The invalid-args correction budget was exhausted. */
  exhausted: boolean;
}

/**
 * Whether the submit-missing re-prompt loop must stop before the next nudge.
 *
 * `llmAbort` matters as much as cancel/cap: when a turn ended with
 * `stopReason: 'error'` and the provider-error retry budget is spent (or the
 * error is non-retryable), `promptWithProviderErrorRetries` returns
 * `runError: null` yet leaves `llmAbort` set. Re-prompting then would nudge a
 * dead provider N more times (extra prompts + backoff) and emit misleading
 * `submit_missing_reprompt` events. We only re-prompt after a genuinely clean
 * `end_turn`.
 */
export function submitRepromptStopped(state: {
  cancelled: boolean;
  capAborted: boolean;
  llmAbort: boolean;
}): boolean {
  return state.cancelled || state.capAborted || state.llmAbort;
}

/**
 * Resolve the submit-missing recovery config from the registered submit tool
 * (if any) plus caller overrides. Extracted as a pure function so the
 * default-budget / disable-when-no-tool / gate-mapping logic is unit-tested —
 * `executePiTask` itself needs a booted VM and can't cover this seam.
 *
 * The default budget (3) is deliberately one higher than the invalid-args
 * correction budget (`maxSubmitValidationRetries`, default 2): a model that
 * never called the tool just needs a clear nudge, which converts more cheaply
 * and more often than fixing a malformed payload, so the extra attempt is
 * worth it.
 */
export function resolveSubmitMissingConfig(args: {
  submitToolHandle: Pick<
    SubmitOutputToolHandle,
    'toolName' | 'getCaptured' | 'getExhaustedValidationFailure'
  > | null;
  maxSubmitMissingReprompts?: number;
  submitMissingPrompt?: string;
}): {
  maxSubmitMissingReprompts: number;
  submitMissingPrompt: string;
  getSubmitState: () => SubmitGateState | null;
} {
  const handle = args.submitToolHandle;
  if (!handle) {
    // No submit tool (legacy parser path): recovery is meaningless. The empty
    // prompt is never sent because the budget is 0.
    return {
      maxSubmitMissingReprompts: 0,
      submitMissingPrompt: '',
      getSubmitState: () => null,
    };
  }
  return {
    maxSubmitMissingReprompts: args.maxSubmitMissingReprompts ?? 3,
    submitMissingPrompt:
      args.submitMissingPrompt ?? buildSubmitMissingPrompt(handle.toolName),
    getSubmitState: () => ({
      captured: handle.getCaptured() !== null,
      exhausted: handle.getExhaustedValidationFailure() !== null,
    }),
  };
}

export interface SubmitMissingRepromptEvent extends Record<string, unknown> {
  event: 'submit_missing_reprompt';
  retry: number;
  maxReprompts: number;
}

export interface PromptUntilSubmittedArgs {
  /**
   * Runs one provider-error-tolerant prompt pass with the given text and
   * resolves with any terminal run error. Normally wraps
   * `promptWithProviderErrorRetries` so every pass — initial and re-prompt —
   * inherits the same provider-error retry, cancel, and cap handling.
   */
  runPrompt: (
    promptText: string,
  ) => Promise<{ runError: { code: string; message: string } | null }>;
  /** First prompt sent to the session (the task prompt). */
  initialPrompt: string;
  /**
   * Continuation sent when a pass ends without a captured submit call. It
   * must instruct the model to call the submit tool now.
   */
  submitMissingPrompt: string;
  /**
   * Number of extra "you forgot to submit" nudges allowed after the initial
   * pass. `0` disables submit-missing recovery (single pass). The caller
   * still surfaces `submit_output_missing` when the budget is spent.
   */
  maxSubmitMissingReprompts: number;
  /**
   * Reads the submit gate after each pass. Returns `null` when no submit
   * tool is registered (legacy parser path) — recovery is skipped.
   */
  getSubmitState: () => SubmitGateState | null;
  /** True when cancel or cap-abort fired; halts further re-prompts. */
  isStopped: () => boolean;
  onSubmitReprompt?: (
    event: SubmitMissingRepromptEvent,
  ) => Promise<void> | void;
}

/**
 * Drive a Pi session until it either captures a valid submit-output call or
 * exhausts the submit-missing re-prompt budget.
 *
 * This is the third same-session recovery path, complementing the two that
 * already existed:
 *   1. Invalid submit args → the submit tool returns `isError`, the model
 *      re-calls within the same turn (see `submit-output-tool.ts`).
 *   2. Provider/LLM API errors → `promptWithProviderErrorRetries` re-prompts.
 *
 * The gap this closes: a model (typically a weaker one) that ends its turn
 * cleanly with a prose answer and *never calls the submit tool at all*. With
 * neither a captured payload nor an exhausted validation budget, the executor
 * would otherwise fail straight to `submit_output_missing` with no chance to
 * recover. Here we nudge the model — up to `maxSubmitMissingReprompts` times —
 * to call the submit tool. Pi cannot force `toolChoice`, so this re-prompt is
 * the only in-session lever short of patching Pi. See issue #1528.
 */
export async function promptUntilSubmitted(
  args: PromptUntilSubmittedArgs,
): Promise<{
  runError: { code: string; message: string } | null;
  submitReprompts: number;
}> {
  const first = await args.runPrompt(args.initialPrompt);
  if (first.runError) {
    return { runError: first.runError, submitReprompts: 0 };
  }

  let submitReprompts = 0;
  while (submitReprompts < args.maxSubmitMissingReprompts) {
    if (args.isStopped()) break;
    const state = args.getSubmitState();
    // Nothing to recover: no submit tool, output already captured, or the
    // invalid-args correction budget is already spent (its own terminal
    // error wins — a fresh nudge would only burn turns).
    if (!state || state.captured || state.exhausted) break;

    submitReprompts += 1;
    await args.onSubmitReprompt?.({
      event: 'submit_missing_reprompt',
      retry: submitReprompts,
      maxReprompts: args.maxSubmitMissingReprompts,
    });
    const pass = await args.runPrompt(args.submitMissingPrompt);
    if (pass.runError) {
      return { runError: pass.runError, submitReprompts };
    }
  }

  return { runError: null, submitReprompts };
}

export function sanitizeProviderErrorRetryReason(
  value: string | null | undefined,
): string {
  const raw = value ?? 'Pi turn ended with stopReason=error';
  return redactRetryTriageSecrets(raw).slice(0, 500);
}

async function sleepUnlessAborted(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, delayMs);
    const onAbort = () => done();
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Detect pi's bash-timeout error wrapper in a `tool_execution_end`
 * result. The bash tool surfaces a timeout as a structured tool result
 * `{ content: [{ type: 'text', text: '… Command timed out after N
 * seconds' }] }` (see `@earendil-works/pi-coding-agent`'s bash.js).
 * Substring-match against the stable wrapper string is the only
 * mechanism short of patching pi; the string is part of pi's external
 * tool-error API and changing it would break agents that read tool
 * errors.
 */
export function isBashTimeoutResult(result: unknown): boolean {
  if (result === null || result === undefined) return false;
  // String form, in case pi ever flattens.
  if (typeof result === 'string') {
    return result.includes('Command timed out after');
  }
  if (typeof result !== 'object') return false;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return false;
  for (const part of content) {
    if (
      typeof part === 'object' &&
      part !== null &&
      typeof (part as { text?: unknown }).text === 'string' &&
      (part as { text: string }).text.includes('Command timed out after')
    ) {
      return true;
    }
  }
  return false;
}

const TRUNCATE_LIMIT = 4 * 1024;
function truncateForWire(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length <= TRUNCATE_LIMIT) return value;
    return {
      truncated: value.slice(0, TRUNCATE_LIMIT),
      original_size: value.length,
    };
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= TRUNCATE_LIMIT) return value;
    return {
      truncated: serialized.slice(0, TRUNCATE_LIMIT),
      original_size: serialized.length,
    };
  } catch {
    return { truncated: '[unserializable]', original_size: -1 };
  }
}

export function describeToolErrorMessage(result: unknown): string {
  if (typeof result === 'string' && result.trim().length > 0) {
    return result.trim();
  }
  if (result && typeof result === 'object') {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (
          item &&
          typeof item === 'object' &&
          typeof (item as { text?: unknown }).text === 'string'
        ) {
          const text = (item as { text: string }).text.trim();
          if (text.length > 0) return text;
        }
      }
    }
  }
  try {
    return JSON.stringify(truncateForWire(result));
  } catch {
    return 'Tool call failed';
  }
}
