/**
 * executePiTask — run a single Task attempt using pi-coding-agent inside a
 * Gondolin sandbox.
 *
 * This is the pi-specific task executor. It owns:
 *   - VM lifecycle (ensureSnapshot + resumeVm + close)
 *   - Gondolin-redirected tool wiring (read/write/edit/bash → VM)
 *   - MoltNet custom tools (diary entries, pack render/judge, etc.)
 *   - pi createAgentSession + event → TaskReporter bridge
 *
 * `@moltnet/agent-runtime` is coding-agent-agnostic: it owns the Task loop,
 * reporters, sources, and prompt builders, but it does NOT depend on pi or
 * Gondolin. Concrete runtimes (this one, a future Codex one, a future direct
 * Anthropic-SDK one) plug in via the `executeTask` function injected into
 * `AgentRuntime`.
 */
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { type Api, getModel, type Model } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  createAgentSession,
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  DefaultResourceLoader,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import { computeJsonCid } from '@moltnet/crypto-service';
import { Value } from '@sinclair/typebox/value';
import {
  buildTaskUserPrompt,
  type ClaimedTask,
  TaskContext,
  type TaskOutput,
  type TaskReporter,
  type TaskUsage,
  type TaskUserPromptContext,
} from '@themoltnet/agent-runtime';
import { connect } from '@themoltnet/sdk';

import {
  createMoltNetTools,
  HOST_EXEC_DEFAULT_BASE_ENV,
} from '../moltnet/tools.js';
import { createPiOtelExtension } from '../otel/index.js';
import { ensureSnapshot, type SandboxConfig } from '../snapshot.js';
import {
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinReadOps,
  createGondolinWriteOps,
} from '../tool-operations.js';
import { activateAgentEnv, findMainWorktree, resumeVm } from '../vm-manager.js';
import { injectTaskContext } from './inject-task-context.js';
import { buildRuntimeInstructor } from './runtime-instructor.js';
import { resolveSubmitTools } from './submit-output-tool.js';
import {
  parseStructuredTaskOutput,
  recordTaskOutputParseResult,
} from './task-output.js';

export interface ExecutePiTaskOptions {
  /** MoltNet agent whose credentials the VM boots with. */
  agentName: string;
  /** Host cwd that the VM mounts at /workspace (defaults to `process.cwd()`). */
  mountPath?: string;
  /** LLM selection. */
  provider: string;
  model: string;
  /** Extra hosts to allow in the sandbox egress policy. */
  extraAllowedHosts?: string[];
  /** Sandbox overrides (env, VFS shadows, resources). */
  sandboxConfig?: SandboxConfig;
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
    return executePiTask(claimedTask, reporter, {
      ...opts,
      checkpointPath: cachedCheckpoint,
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
  const mountPath = opts.mountPath ?? process.cwd();

  // Pre-execute cancel guard. If the reporter's cancel signal is already
  // aborted (the imposer cancelled between claim and executor entry), don't
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

  const checkpointPath =
    opts.checkpointPath ??
    (await ensureSnapshot({
      config: opts.sandboxConfig?.snapshot,
      onProgress:
        opts.onSnapshotProgress ??
        ((m) => {
          process.stderr.write(`[snapshot] ${m}\n`);
        }),
    }));

  // Repair worktree pointers on the host before the VM mounts the tree.
  // Mirrors the interactive extension (libs/pi-extension/src/index.ts):
  // rewrites each worktree's `.git` pointer and backlink to relative form
  // so the VM (which sees the tree at `/workspace`) can still follow them,
  // provided the worktree's relative depth from the main repo matches the
  // VM's layout. No-op if nothing needs fixing.
  const mainRepoForRepair = findMainWorktree();
  try {
    execFileSync(
      'git',
      ['-C', mainRepoForRepair, 'worktree', 'repair', '--relative-paths'],
      { stdio: 'pipe' },
    );
  } catch {
    // Best-effort — older git versions lack --relative-paths.
  }

  const managed = await resumeVm({
    checkpointPath,
    agentName: opts.agentName,
    mountPath,
    extraAllowedHosts: opts.extraAllowedHosts,
    sandboxConfig: opts.sandboxConfig,
  });

  const diaryId = task.diaryId ?? '';
  const taskTeamId = task.teamId ?? '';
  let reporterOpen = false;
  let session:
    | Awaited<ReturnType<typeof createAgentSession>>['session']
    | null = null;
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

  try {
    const mainRepo = findMainWorktree();
    activateAgentEnv(managed.credentials.agentEnv, mainRepo);

    await reporter.open({ taskId: task.id, attemptN });
    reporterOpen = true;

    const emit = (
      kind: Parameters<TaskReporter['record']>[0]['kind'],
      payload: Record<string, unknown>,
    ) => reporter.record({ kind, payload });

    await emit('info', {
      event: 'execute_start',
      taskType: task.taskType,
      teamId: task.teamId,
      provider: opts.provider,
      model: opts.model,
    });

    let taskPrompt: string;
    try {
      const promptCtx: TaskUserPromptContext = {
        diaryId,
        taskId: task.id,
        extras: opts.promptExtras,
      };
      taskPrompt = buildTaskUserPrompt(task, promptCtx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emit('error', { message, phase: 'prompt_build' });
      return makeFailedOutput('prompt_build_failed', message);
    }

    // Slice 1.5 of #943 — resolve task.input.context[] into delivered
    // skill files, system-prompt prefix, and user-message suffix. Only
    // task types that carry a TaskContext fragment in their input
    // schema (currently `run_eval`) populate this; everywhere else
    // `rawContext` is undefined and the resolver short-circuits on an
    // empty array.
    const rawContext = (task.input as { context?: unknown }).context;
    let injectedContext: Awaited<ReturnType<typeof injectTaskContext>>;
    try {
      const contextArray = rawContext === undefined ? [] : rawContext;
      if (!Value.Check(TaskContext, contextArray)) {
        throw new Error(
          `task.input.context failed TaskContext validation: ${JSON.stringify(
            [...Value.Errors(TaskContext, contextArray)].slice(0, 3),
          )}`,
        );
      }
      injectedContext = await injectTaskContext({
        context: contextArray,
        fs: managed.vm.fs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emit('error', { message, phase: 'context_resolution' });
      return makeFailedOutput('context_resolution_failed', message);
    }

    if (injectedContext.injected.length > 0) {
      await emit('info', {
        event: 'context_injected',
        count: injectedContext.injected.length,
        bindings: injectedContext.injected.map((r) => r.binding),
        slugs: injectedContext.injected.map((r) => r.slug),
      });
    }

    if (injectedContext.userInlineSuffix) {
      taskPrompt = `${taskPrompt}\n\n---\n\n${injectedContext.userInlineSuffix}`;
    }

    // pi's createAgentSession only treats `tools:` as a name-filter; the actual
    // read/write/edit/bash implementations are rebuilt from defaults inside the
    // session unless we route them through customTools, which DOES override the
    // default by name at definition-registry merge time (AgentSession._refreshToolRegistry).
    const gondolinCustomTools = [
      createReadToolDefinition(mountPath, {
        operations: createGondolinReadOps(managed.vm, mountPath),
      }),
      createWriteToolDefinition(mountPath, {
        operations: createGondolinWriteOps(managed.vm, mountPath),
      }),
      createEditToolDefinition(mountPath, {
        operations: createGondolinEditOps(managed.vm, mountPath),
      }),
      createBashToolDefinition(mountPath, {
        operations: createGondolinBashOps(managed.vm, mountPath),
      }),
    ] as unknown as ToolDefinition[];

    // Per-task-type submit-output tool. Captured payload (when the
    // model calls the tool with valid args) becomes the authoritative
    // output; the parser fallback is only consulted when the model
    // never calls the tool, OR when the task type has no registered
    // output schema (resolveSubmitTools returns null).
    const { handle: submitToolHandle, tools: submitToolDefs } =
      resolveSubmitTools(task.taskType, { model: opts.model });
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
        getHostCwd: () => mountPath,
        hostExecBaseEnv,
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

      const piOtelExtension = createPiOtelExtension({
        agentName: opts.agentName,
        // MoltNet-specific attributes only. The extension owns gen_ai.*
        // keys (populated from pi's model_select / turn_start events) and
        // filters any gen_ai.* passed here.
        spanAttributes: {
          'moltnet.task.id': task.id,
          'moltnet.task.attempt': attemptN,
          'moltnet.task.type': task.taskType,
        },
      });
      // Daemon-controlled runtime isolation (issue #979 + #943 slice 1.5):
      //  - Inline the runtime instructor as appendSystemPrompt so the
      //    invariants (gh auth, diary discipline, accountable commits) are
      //    in the system prompt every turn, not lazily fetched via a
      //    pi Skill pointer the model may or may not follow.
      //  - Append `injectedContext.systemPromptPrefix` after the runtime
      //    instructor when the task's input.context contributed any
      //    `prompt_prefix` bindings. Empty string when none — guarded so
      //    we don't pass an empty entry to pi.
      //  - skillsOverride returns ONLY the skills resolved from
      //    input.context (binding: 'skill'). Locally-discovered skills
      //    (`cwd/.pi/skills`, `~/.pi/agent/skills`, …) are discarded so
      //    untrusted local prose never appears as a `<location>` pointer
      //    in the system prompt's `<available_skills>` block.
      const runtimeInstructor = buildRuntimeInstructor({
        taskId: task.id,
        taskType: task.taskType,
        attemptN,
        diaryId,
        agentName: opts.agentName,
        correlationId: task.correlationId ?? null,
      });
      const appendSystemPrompt: string[] = [runtimeInstructor];
      if (injectedContext.systemPromptPrefix) {
        appendSystemPrompt.push(injectedContext.systemPromptPrefix);
      }
      const injectedSkills = injectedContext.skills;
      const resourceLoader = new DefaultResourceLoader({
        cwd: mountPath,
        agentDir: piAuthDir,
        extensionFactories: [piOtelExtension],
        appendSystemPrompt,
        skillsOverride: () => ({ skills: injectedSkills, diagnostics: [] }),
      });
      await resourceLoader.reload();

      const created = await createAgentSession({
        agentDir: piAuthDir,
        cwd: mountPath,
        model: modelHandle,
        customTools: [...gondolinCustomTools, ...moltnetTools, ...submitTools],
        sessionManager: SessionManager.inMemory(),
        resourceLoader,
      });
      session = created.session;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emit('error', { message, phase: 'session_setup' });
      return makeFailedOutput('session_setup_failed', message);
    }

    let llmAbort = false;
    // The diagnostic pi attaches to the final assistant message when
    // stopReason === 'error'. Captured below in the `turn_end` handler;
    // forwarded to the task's `error.message` so operators see things
    // like "Model 'gpt-5.4-codex' not found in registry" instead of
    // the generic 'LLM API error during turn'.
    let llmErrorMessage: string | null = null;
    let assistantText = '';
    let reporterError: { code: string; message: string } | null = null;
    const usage: TaskUsage = finalUsage;

    // Wire reporter.cancelSignal → session.abort() so the LLM session
    // tears down promptly when the imposer cancels mid-prompt. Tracked
    // via `cancelListener` at function scope so `finally` can remove it
    // even if we throw.
    cancelListener = wireSessionAbort(reporter.cancelSignal, session);
    const recordingPromise: Promise<void>[] = [];
    const track = (p: Promise<void>) => {
      recordingPromise.push(
        p.catch((err: unknown) => {
          if (!reporterError) {
            const message = err instanceof Error ? err.message : String(err);
            reporterError = { code: 'reporter_failed', message };
            process.stderr.write(`[reporter] ${message}\n`);
          }
        }),
      );
    };

    session.subscribe((event) => {
      if (event.type === 'message_update') {
        const ae = event.assistantMessageEvent;
        if (ae.type === 'text_delta') {
          assistantText += ae.delta;
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
        track(emit('turn_end', { stop_reason: msg?.stopReason ?? 'end_turn' }));
        // Reflect ONLY the final turn's stop reason. pi emits turn_end per
        // assistant turn; a transient error in an earlier turn that pi then
        // recovers from (next turn completes cleanly) must not fail the task.
        // session.prompt() resolves after the final turn, so by the time we
        // read llmAbort below it holds the terminal state.
        llmAbort = msg?.stopReason === 'error';
        // Mirror the same "last-turn wins" rule for the error message:
        // overwrite on each error turn, clear on a recovered turn so a
        // transient earlier failure doesn't bleed into the final result.
        if (msg?.stopReason === 'error') {
          llmErrorMessage =
            typeof msg.errorMessage === 'string' && msg.errorMessage.length > 0
              ? msg.errorMessage
              : null;
        } else {
          llmErrorMessage = null;
        }
      }
    });

    let runError: { code: string; message: string } | null = null;
    try {
      await session.prompt(taskPrompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      runError = { code: 'session_prompt_failed', message };
      await emit('error', { message, phase: 'session_prompt' });
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
    if (!runError && !llmAbort && !cancelled) {
      // Prefer the submit-tool's captured payload over the parser path.
      // The submit-tool already validated args against the task type's
      // output schema; if the model called it successfully we trust the
      // captured value and skip parsing the trailing assistant text.
      const captured = submitToolHandle?.getCaptured() ?? null;
      if (captured) {
        try {
          parsedOutput = captured;
          parsedOutputCid = await computeJsonCid(captured);
          recordTaskOutputParseResult({
            taskType: task.taskType,
            model: opts.model,
            code: 'captured_via_tool',
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          parsedOutput = null;
          parsedOutputCid = null;
          parseError = {
            code: 'output_cid_compute_failed',
            message: `Captured submit-tool output could not be canonicalized: ${message}`,
          };
          recordTaskOutputParseResult({
            taskType: task.taskType,
            model: opts.model,
            code: 'output_cid_compute_failed',
          });
          await emit('error', {
            message: parseError.message,
            phase: 'output_validation',
          });
        }
      } else {
        const parsed = await parseStructuredTaskOutput(
          assistantText,
          task.taskType,
          { model: opts.model },
        );
        parsedOutput = parsed.output;
        parsedOutputCid = parsed.outputCid;
        parseError = parsed.error;
        if (parseError) {
          await emit('error', {
            message: parseError.message,
            phase: 'output_validation',
          });
        }
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
            'Task cancelled by imposer while pi session was running.',
          retryable: false,
        },
      };
    }

    const status: TaskOutput['status'] =
      runError || llmAbort || parseError || reporterError
        ? 'failed'
        : 'completed';
    const errorCode =
      runError?.code ??
      parseError?.code ??
      (reporterError as { code: string } | null)?.code ??
      (llmAbort ? 'llm_api_error' : undefined);
    const errorMessage =
      runError?.message ??
      parseError?.message ??
      (reporterError as { message: string } | null)?.message ??
      (llmAbort
        ? // Prefer the diagnostic pi captured on the assistant message
          // over the generic fallback. Most provider failures (model
          // not in registry, auth errors, rate limits, …) surface here
          // with the exact reason; without it operators have no way
          // to distinguish "wrong model id" from "expired token" from
          // "rate limited" without re-running locally.
          (llmErrorMessage ?? 'LLM API error during turn')
        : undefined);

    return {
      taskId: task.id,
      attemptN: attemptN,
      status,
      output: parsedOutput,
      outputCid: parsedOutputCid,
      usage,
      durationMs: Date.now() - startTime,
      ...(errorCode && errorMessage
        ? {
            error: { code: errorCode, message: errorMessage, retryable: false },
          }
        : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeFailedOutput('executor_unexpected_error', message);
  } finally {
    // Remove the cancel listener before disposing the session so it
    // can't fire after `dispose()` has torn the session down. `once`
    // makes this redundant when the listener has already fired, but
    // removeEventListener is a no-op in that case.
    if (cancelListener) {
      reporter.cancelSignal.removeEventListener('abort', cancelListener);
    }
    if (session) {
      try {
        session.dispose();
      } catch {
        /* swallow */
      }
    }
    if (reporterOpen) {
      try {
        await reporter.finalize(finalUsage);
      } catch (err) {
        // finalize() drains the reporter's buffer, so a failure here means
        // buffered messages were lost or a retry restored them to the
        // buffer — either way the task is about to be marked complete.
        // Log to stderr so the loss is visible in the worker log instead
        // of hidden inside an empty catch.
        const detail = err instanceof Error ? err.message : String(err);
        console.error(
          `executePiTask: reporter.finalize() failed for task ${task.id} ` +
            `attempt ${attemptN}: ${detail}`,
        );
      }
      try {
        await reporter.close();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(
          `executePiTask: reporter.close() failed for task ${task.id} ` +
            `attempt ${attemptN}: ${detail}`,
        );
      }
    }
    await managed.vm.close();
  }
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
