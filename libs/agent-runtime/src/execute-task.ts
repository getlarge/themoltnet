/**
 * executeTask — run a single Task attempt in a Gondolin sandbox.
 *
 * Extracted from tools/src/resolve-issue.ts (the PR 0 prototype). No
 * behavior change vs the original main() from line 218 onward; structural
 * refactor to:
 *   - drop GitHub-specific prompt building (now handled by prompt
 *     builders keyed on task.task_type)
 *   - route ALL I/O through `ctx.reporter` so the same function works in
 *     local mode (stdout/jsonl) and API mode (HTTP, PR 7)
 *   - return a structured `TaskOutput` instead of exiting the process
 *
 * This function does NOT know:
 *   - where the task came from (file? HTTP claim? args?)
 *   - where the output goes (stdout? file? server POST?)
 *   - how retries are orchestrated
 *
 * Those concerns belong to `TaskSource` + `TaskReporter` + `AgentRuntime`.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { type Api, getModel, type Model } from '@mariozechner/pi-ai';
import {
  createAgentSession,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  SessionManager,
} from '@mariozechner/pi-coding-agent';
import type { Task, TaskOutput, TaskUsage } from '@moltnet/tasks';
import {
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinReadOps,
  createGondolinWriteOps,
  createMoltNetTools,
  type ManagedVm,
} from '@themoltnet/pi-extension';
import { connect } from '@themoltnet/sdk';

import { buildPromptForTask, type PromptContext } from './prompts/index.js';
import type { TaskReporter } from './reporters/index.js';

export interface ExecuteTaskContext {
  /** Host cwd that the VM has mounted as /workspace. */
  cwd: string;
  /** Agent's credential dir (`.moltnet/<agent>/`). */
  agentDir: string;
  /** Running, resumed Gondolin VM. The runtime opens and closes this. */
  managedVm: ManagedVm;
  /** Where tool-call events + usage go. */
  reporter: TaskReporter;
  /** LLM selection. */
  provider: string;
  model: string;
  /**
   * Extra context for per-type prompt builders (e.g. the target summary
   * for assess_brief). Forwarded untouched to `buildPromptForTask`.
   */
  promptExtras?: Record<string, unknown>;
  /** Attempt number; defaults to 1 (PR 0 only runs attempt 1). */
  attemptN?: number;
}

/**
 * Run one attempt of `task`, streaming events through `ctx.reporter`.
 * Resolves with a compact `TaskOutput`. Does NOT throw on agent failure —
 * failures come back as `status: 'failed'` with structured `error`.
 * Throws only on unrecoverable setup failures (bad inputs, VM closed).
 */
export async function executeTask(
  task: Task,
  ctx: ExecuteTaskContext,
): Promise<TaskOutput> {
  const attemptN = ctx.attemptN ?? 1;
  const startTime = Date.now();

  const diaryId = task.diary_id ?? '';
  await ctx.reporter.open({ taskId: task.id, attemptN });

  const emit = (
    kind: Parameters<TaskReporter['record']>[0]['kind'],
    payload: Record<string, unknown>,
  ) => ctx.reporter.record({ kind, payload });

  await emit('info', {
    event: 'execute_start',
    task_type: task.task_type,
    team_id: task.team_id,
    provider: ctx.provider,
    model: ctx.model,
  });

  // Build the type-specific prompt BEFORE provisioning the session. If
  // validation fails, fail fast — the VM is already running but we haven't
  // paid for any LLM calls.
  let taskPrompt: string;
  try {
    const promptCtx: PromptContext = {
      diaryId,
      taskId: task.id,
      extras: ctx.promptExtras,
    };
    taskPrompt = buildPromptForTask(task, promptCtx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await emit('error', { message, phase: 'prompt_build' });
    const failedOutput: TaskOutput = {
      task_id: task.id,
      attempt_n: attemptN,
      status: 'failed',
      output: null,
      output_cid: null,
      usage: emptyUsage(ctx.provider, ctx.model),
      duration_ms: Date.now() - startTime,
      error: { code: 'prompt_build_failed', message, retryable: false },
    };
    await ctx.reporter.finalize(failedOutput.usage);
    await ctx.reporter.close();
    return failedOutput;
  }

  // Provision sandboxed tools (same as the original resolve-issue.ts).
  const gondolinRead = createReadTool(ctx.cwd, {
    operations: createGondolinReadOps(ctx.managedVm.vm, ctx.cwd),
  });
  const gondolinWrite = createWriteTool(ctx.cwd, {
    operations: createGondolinWriteOps(ctx.managedVm.vm, ctx.cwd),
  });
  const gondolinEdit = createEditTool(ctx.cwd, {
    operations: createGondolinEditOps(ctx.managedVm.vm, ctx.cwd),
  });
  const gondolinBash = createBashTool(ctx.cwd, {
    operations: createGondolinBashOps(ctx.managedVm.vm, ctx.cwd),
  });

  const moltnetAgent = await connect({ configDir: ctx.agentDir });
  const moltnetTools = createMoltNetTools({
    getAgent: () => moltnetAgent,
    getDiaryId: () => diaryId,
    getSessionErrors: () => [],
    clearSessionErrors: () => {
      /* no-op in headless mode */
    },
  });

  const piAuthDir = join(homedir(), '.pi', 'agent');
  // Provider/model IDs are user-supplied strings; the strict overload of
  // getModel requires literal types, so widen to the generic Model<Api>.
  const getModelLoose = getModel as unknown as (
    provider: string,
    modelId: string,
  ) => Model<Api>;
  const modelHandle = getModelLoose(ctx.provider, ctx.model);

  const { session } = await createAgentSession({
    agentDir: piAuthDir,
    model: modelHandle,
    tools: [gondolinRead, gondolinWrite, gondolinEdit, gondolinBash],
    customTools: moltnetTools,
    sessionManager: SessionManager.inMemory(),
  });

  let llmAbort = false;
  const recordingPromise: Promise<void>[] = [];

  const track = (p: Promise<void>) => {
    recordingPromise.push(
      p.catch(() => {
        /* swallow; individual record errors shouldn't kill the session */
      }),
    );
  };

  session.subscribe((event) => {
    if (event.type === 'message_update') {
      const ae = event.assistantMessageEvent;
      if (ae.type === 'text_delta') {
        track(emit('text_delta', { delta: ae.delta }));
      }
    } else if (event.type === 'tool_execution_start') {
      track(emit('tool_call_start', { tool_name: event.toolName }));
    } else if (event.type === 'tool_execution_end') {
      track(
        emit('tool_call_end', {
          tool_name: event.toolName,
          is_error: event.isError,
          result: event.isError ? event.result : undefined,
        }),
      );
    } else if (event.type === 'turn_end') {
      const msg = (event as Record<string, unknown>)['message'] as
        | { stopReason?: string }
        | undefined;
      track(emit('turn_end', { stop_reason: msg?.stopReason ?? 'end_turn' }));
      if (msg?.stopReason === 'error') {
        llmAbort = true;
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

  // Let in-flight reporter writes settle before we close it.
  await Promise.all(recordingPromise);

  const usage = emptyUsage(ctx.provider, ctx.model);
  await ctx.reporter.finalize(usage);
  session.dispose();
  await ctx.reporter.close();

  const status: TaskOutput['status'] =
    runError || llmAbort ? 'failed' : 'completed';
  const errorCode = runError?.code ?? (llmAbort ? 'llm_api_error' : undefined);
  const errorMessage =
    runError?.message ?? (llmAbort ? 'LLM API error during turn' : undefined);

  const output: TaskOutput = {
    task_id: task.id,
    attempt_n: attemptN,
    status,
    output: null,
    output_cid: null,
    usage,
    duration_ms: Date.now() - startTime,
    ...(errorCode && errorMessage
      ? { error: { code: errorCode, message: errorMessage, retryable: false } }
      : {}),
  };

  return output;
}

function emptyUsage(provider: string, model: string): TaskUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    provider,
    model,
  };
}
