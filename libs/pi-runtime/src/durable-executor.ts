import type { Context } from '@earendil-works/chord';
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from '@earendil-works/chord/context';
import type { Models, UserMessage } from '@earendil-works/pi-ai';
import {
  type AgentChange,
  CompactionTask,
  configure,
  type Conversation,
  type ConversationId,
  createRegistry,
  defineDocFamily,
  defineExtension,
  defineTool,
  type Extension,
  GenerationTask,
  Harness,
  hook,
  type JsonObject,
  type Storage,
  type ToolExecutionResult,
  type ToolRegistration,
  ToolTask,
  type UsageState,
} from '@earendil-works/pi-durable';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import type { TelemetryContext } from '@earendil-works/pi-telemetry';
import { computeJsonCid } from '@moltnet/crypto-service/json-cid';
import {
  materializeTaskOutput,
  type TaskOutput,
  type TaskUsage,
} from '@moltnet/tasks';
import {
  buildTaskUserPrompt,
  type ClaimedTask,
  getSubmitOutputContract,
  type SubagentContractRegistry,
  TaskExecutionInterrupted,
  type TaskExecutor,
  type TaskReporter,
  validateAgentTaskOutput,
  validateAgentTaskSubmission,
} from '@themoltnet/agent-runtime';
import { Value } from 'typebox/value';

import { taskUsageFromState, usageSince } from './durable-usage.js';
import { createPiTelemetry } from './otel/durable.js';
import { classifyProviderFailure } from './runtime/provider-error-classification.js';
import { redactRetryTriageSecrets } from './runtime/retry-triage.js';
import { SubagentToolParameters } from './runtime/subagent-parameters.js';
import {
  formatValidationErrors,
  normalizeSubmitArguments,
  parseFinalMessageSubmission,
  submitOutputGuidance,
} from './runtime/submit-output-tool.js';

const Subagents = defineDocFamily({
  kind: 'moltnet.subagent',
  version: 1,
  scope: 'session',
  family: true,
  checkpointWhen: () => false,
  initial: (_seed: null) => ({ output: null as JsonObject | null, turns: 0 }),
});

const Attempts = defineDocFamily({
  kind: 'moltnet.attempt',
  version: 1,
  scope: 'session',
  family: true,
  checkpointWhen: () => false,
  initial: (seed: {
    conversationId: number;
    startedAt: number;
    baseline: TaskUsage;
    /** Session usage when the attempt began; absent on attempts started before it existed. */
    baselineUsage?: UsageState;
  }) => ({
    ...seed,
    submission: null as JsonObject | null,
    result: null as JsonObject | null,
    environment: null as JsonObject | null,
    turns: 0,
    reminders: 0,
    invalidFinalMessages: 0,
    finalMessageError: null as string | null,
    lastToolRound: null as string | null,
    outputSource: null as 'submit_tool' | 'final_message' | null,
    bashTimeouts: 0,
  }),
});

// The Durable `bash` tool throws this text on timeout, and the Harness keeps a
// thrown message as the result's `tool_error` diagnostic.
const BASH_TIMEOUT = /^Command timed out after /;

/** Tool rounds left at which the model is told to submit. */
const TURN_BUDGET_WARNING_ROUNDS = 3;

/**
 * A request-only notice that the turn budget is nearly spent. Without it the
 * model cannot see the limit and an exploring attempt ends with no output.
 */
function turnBudgetNotice(
  remaining: number,
  toolName: string,
  messages: readonly { timestamp?: number }[],
): UserMessage {
  return {
    role: 'user',
    content:
      `Runtime notice: ${remaining} tool round${remaining === 1 ? '' : 's'} ` +
      `left before this attempt ends without output. Stop investigating and ` +
      `call ${toolName} now with your best result. Report anything you could ` +
      `not verify as uncertain instead of investigating further.`,
    // Derived from the conversation so a replayed request is identical.
    timestamp: messages.at(-1)?.timestamp ?? 0,
  };
}

function isBashTimeout(result: ToolExecutionResult): boolean {
  return (
    result.isError === true &&
    (result.diagnostics ?? []).some(
      (diagnostic) =>
        diagnostic.code === 'tool_error' &&
        BASH_TIMEOUT.test(diagnostic.message),
    )
  );
}

async function abortGeneration(
  harness: Harness,
  taskId: Parameters<Harness['abortTask']>[0],
  context: Context,
) {
  // Hook exceptions are diagnostics in Durable. Signal this invocation before
  // throwing, without awaiting the abort operation that joins the invocation.
  await new Promise<void>((resolve, reject) => {
    const signal = context.abortSignal!;
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
    void harness.abortTask(taskId, BACKGROUND_CONTEXT).catch(reject);
  });
  context.abortSignal!.throwIfAborted();
}

/** Aggregate counters only: the pre-`baselineUsage` continuation baseline. */
function totals(state: UsageState): TaskUsage {
  const result: TaskUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  for (const usage of [
    ...Object.values(state.models),
    ...Object.values(state.tools),
  ]) {
    result.inputTokens += usage.input;
    result.outputTokens += usage.output;
    result.cacheReadTokens! += usage.cacheRead;
    result.cacheWriteTokens! += usage.cacheWrite;
  }
  return result;
}

/**
 * What this attempt spent. Without a recorded `baselineUsage` (an attempt that
 * began before it existed) only an empty baseline is exact; a continuation
 * then falls back to aggregate counters, without the per-model split or cost.
 */
function attemptUsage(
  current: UsageState,
  seed: { baseline: TaskUsage; baselineUsage?: UsageState },
  model: { provider: string; modelId: string },
): TaskUsage {
  const primary = { provider: model.provider, model: model.modelId };
  const legacy = seed.baseline;
  if (seed.baselineUsage || legacy.inputTokens + legacy.outputTokens === 0)
    return taskUsageFromState(usageSince(current, seed.baselineUsage), primary);
  const total = totals(current);
  return {
    inputTokens: Math.max(0, total.inputTokens - legacy.inputTokens),
    outputTokens: Math.max(0, total.outputTokens - legacy.outputTokens),
    cacheReadTokens: Math.max(
      0,
      (total.cacheReadTokens ?? 0) - (legacy.cacheReadTokens ?? 0),
    ),
    cacheWriteTokens: Math.max(
      0,
      (total.cacheWriteTokens ?? 0) - (legacy.cacheWriteTokens ?? 0),
    ),
    ...primary,
  };
}

/** No filesystem artifacts: this executor's complete continuation state lives in Storage. */
export function createDurableTaskExecutor(options: {
  models: Models;
  /** Defaults to native Pi instrumentation through the host OTel providers. */
  telemetry?: TelemetryContext;
  model: { provider: string; modelId: string };
  agent?: Omit<AgentChange, 'model'>;
  maxTurns?: number;
  /**
   * Bash timeouts allowed per attempt, counted across resumes and delegated
   * conversations. The next model request after the cap is reached ends the
   * attempt with `max_bash_timeouts_exceeded`. Defaults to 3, like the legacy
   * executor; 0 or less disables the cap.
   */
  maxBashTimeouts?: number;
  subagentContracts?: SubagentContractRegistry;
  maxSubmitReminders?: number;
  open(
    claimed: ClaimedTask,
    signal: AbortSignal,
  ): Promise<{
    storage: Storage;
    signal: AbortSignal;
    check(): void;
    /** Trusted deployment callback; resolve policy and an isolated environment before scheduling. */
    prepare(previousEnvironment: JsonObject | null): Promise<{
      checkpoint?: JsonObject;
      env?: ExecutionEnv;
      tools?: readonly ToolRegistration[];
      extensions?: readonly Extension[];
      subagentExtensions?: readonly Extension[];
      /** Undefined disables delegation; an array is the exact inherited tool surface. */
      subagentTools?: readonly ToolRegistration[];
      prompt?: string;
      instructions?: string;
      authorizeTool(
        name: string,
        args: JsonObject,
        context: Context,
      ): Promise<string | undefined>;
      close(): Promise<void>;
    }>;
  }>;
}): TaskExecutor {
  return async (claimed, reporter) => {
    const { task, attemptN } = claimed;
    // Matches the legacy executor: an absent or non-positive limit is unlimited.
    const turnLimit =
      options.maxTurns !== undefined && options.maxTurns > 0
        ? options.maxTurns
        : undefined;
    const maxBashTimeouts = options.maxBashTimeouts ?? 3;
    const bashTimeoutLimit = maxBashTimeouts > 0 ? maxBashTimeouts : undefined;
    // Attempts persisted before the cap existed carry no counter.
    const bashTimeoutsOf = (state?: { bashTimeouts?: number } | null) =>
      state?.bashTimeouts ?? 0;
    const key = `${task.id}/${attemptN}`;
    const base = { taskId: task.id, attemptN };
    const contract = getSubmitOutputContract(task.taskType, task.input);
    if (!contract) throw new Error(`No output contract for ${task.taskType}`);
    let terminalRecorded = false;
    let harness: Harness | undefined;
    let connection: Awaited<ReturnType<typeof options.open>> | undefined;
    let prepared:
      | Awaited<ReturnType<Awaited<ReturnType<typeof options.open>>['prepare']>>
      | undefined;
    let onAbort: (() => void) | undefined;
    let reporterOpen = false;
    let failed = false;
    // Live task messages are telemetry: Durable storage stays the source of
    // truth, so a reporter failure never fails or interrupts the attempt.
    const emit = async (
      kind: Parameters<TaskReporter['record']>[0]['kind'],
      payload: Record<string, unknown>,
    ) => {
      try {
        await reporter.record({ kind, payload });
      } catch (error) {
        process.stderr.write(
          `durable executor: reporter.record() failed for task ${task.id} attempt ${attemptN} kind="${kind}": ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    };
    try {
      connection = await options.open(claimed, reporter.cancelSignal);
      await reporter.open(base);
      reporterOpen = true;
      const connected = connection;
      const context = withAbortSignal(connected.signal, BACKGROUND_CONTEXT);
      const registry = createRegistry();
      let conversation: Conversation;
      const normalizeSubmission = (args: unknown): JsonObject => {
        let candidate = args;
        try {
          candidate = normalizeSubmitArguments(
            task.taskType,
            args,
            contract.parametersSchema,
            contract.toolName,
            contract.description,
            { input: task.input, inputCid: task.inputCid },
          ).candidate;
          const errors = validateAgentTaskSubmission(
            task.taskType,
            candidate,
            task.input,
            { inputCid: task.inputCid },
          );
          if (errors.length) throw new Error(formatValidationErrors(errors));
          return candidate as JsonObject;
        } catch (error) {
          const errors = validateAgentTaskSubmission(
            task.taskType,
            candidate,
            task.input,
            { inputCid: task.inputCid },
          );
          throw new Error(
            `Output failed validation: ${errors.length ? formatValidationErrors(errors) : String(error)}. Submit corrected output using the tool or a JSON-only final message.`,
          );
        }
      };
      const submit = defineTool({
        name: contract.toolName,
        description: contract.description,
        parameters: contract.parametersSchema,
        constrainedSampling: { type: 'json_schema', strict: 'prefer' },
        prepareArguments: normalizeSubmission,
        replay: 'safe',
        executionMode: 'sequential',
        async execute(args, api, ctx) {
          connected.check();
          const errors = validateAgentTaskSubmission(
            task.taskType,
            args,
            task.input,
            { inputCid: task.inputCid },
          );
          if (errors.length)
            return {
              isError: true,
              output: [
                { type: 'text', text: JSON.stringify(errors.slice(0, 3)) },
              ],
            };
          await api.commit(async (tx) => {
            const state = await tx.doc(Attempts, key, seed);
            if (state.submission === null) {
              state.submission = args as JsonObject;
              state.outputSource = 'submit_tool';
            }
          }, ctx);
          return {
            output: [{ type: 'text', text: 'Output accepted.' }],
            control: { terminate: true },
          };
        },
      });
      let seed: {
        conversationId: number;
        startedAt: number;
        baseline: TaskUsage;
        baselineUsage?: UsageState;
      } = {
        conversationId: 1,
        startedAt: Date.now(),
        baseline: { inputTokens: 0, outputTokens: 0 },
      };
      const guards = defineExtension({
        name: 'moltnet-attempt',
        tools: [submit],
        hooks: [
          hook(ToolTask, {
            async beforeTool(call, _api, ctx) {
              connected.check();
              const block =
                call.name === contract.toolName
                  ? undefined
                  : await prepared!.authorizeTool(
                      call.name,
                      call.arguments as JsonObject,
                      withAbortSignal(connected.signal, ctx),
                    );
              await emit('tool_call_start', { tool_name: call.name });
              if (!block) return undefined;
              // A blocked call settles without afterTool, so close it here.
              await emit('tool_call_end', {
                tool_name: call.name,
                is_error: true,
              });
              return { block };
            },
            async afterTool(call, result) {
              await emit('tool_call_end', {
                tool_name: call.name,
                is_error: result.isError === true,
              });
              if (
                bashTimeoutLimit !== undefined &&
                call.name === 'bash' &&
                isBashTimeout(result)
              ) {
                // Count durably so a resumed attempt keeps its budget.
                await harness!.commit(async (tx) => {
                  const state = await tx.doc(Attempts, key, seed);
                  state.bashTimeouts = bashTimeoutsOf(state) + 1;
                }, context);
              }
              return undefined;
            },
          }),
          hook(GenerationTask, {
            async afterResponse(message) {
              // Replies and tool content are read from the Durable conversation;
              // task messages carry only operational progress and diagnostics.
              if (message.stopReason === 'error')
                await emit('error', {
                  phase: 'session_prompt',
                  message: message.errorMessage ?? 'Model request failed',
                });
              await emit('turn_end', { stop_reason: message.stopReason });
            },
            async afterTools(assistant, _results, _api, ctx) {
              // Text-only validation has its own budget. The committed assistant
              // entry also makes counting a tool round safe to replay on resume.
              await harness!.commit(async (tx) => {
                const state = await tx.doc(Attempts, key, seed);
                if (state.lastToolRound !== String(assistant)) {
                  state.turns += 1;
                  state.lastToolRound = String(assistant);
                }
              }, ctx);
            },
            async beforeRequest(request, api, ctx) {
              connected.check();
              const state = await harness!.snapshot(Attempts, key, ctx);
              const exhausted =
                (turnLimit !== undefined && (state?.turns ?? 0) >= turnLimit) ||
                (bashTimeoutLimit !== undefined &&
                  bashTimeoutsOf(state) >= bashTimeoutLimit);
              if (exhausted) {
                await abortGeneration(harness!, api.taskId, ctx);
                return undefined;
              }
              const remaining =
                turnLimit === undefined
                  ? undefined
                  : turnLimit - (state?.turns ?? 0);
              if (
                remaining !== undefined &&
                remaining <= TURN_BUDGET_WARNING_ROUNDS &&
                !state?.submission
              )
                return {
                  messages: [
                    ...request.messages,
                    turnBudgetNotice(
                      remaining,
                      contract.toolName,
                      request.messages,
                    ),
                  ],
                };
              return undefined;
            },
            async onYield(answer, _api, ctx) {
              connected.check();
              const current = await harness!.snapshot(Attempts, key, ctx);
              if (current?.submission) return undefined;
              const text = answer.content
                .filter((part) => part.type === 'text')
                .map((part) => part.text)
                .join('\n');
              const parsed = parseFinalMessageSubmission(text);
              let validationError: string | undefined;
              if (parsed) {
                let candidate: JsonObject | undefined;
                try {
                  candidate = normalizeSubmission(parsed);
                } catch (error) {
                  validationError =
                    error instanceof Error ? error.message : String(error);
                }
                if (candidate) {
                  const submission = candidate;
                  await harness!.commit(async (tx) => {
                    const state = await tx.doc(Attempts, key, seed);
                    state.submission ??= submission;
                    state.outputSource = 'final_message';
                  }, ctx);
                  return undefined;
                }
              }
              let remind = false;
              let invalidCount = 0;
              await harness!.commit(async (tx) => {
                const state = await tx.doc(Attempts, key, seed);
                if (validationError) {
                  state.finalMessageError = validationError;
                  state.invalidFinalMessages =
                    (state.invalidFinalMessages ?? 0) + 1;
                  invalidCount = state.invalidFinalMessages;
                }
                if (
                  !state.submission &&
                  state.reminders < (options.maxSubmitReminders ?? 3)
                ) {
                  state.reminders += 1;
                  remind = true;
                }
              }, ctx);
              if (validationError)
                await emit('info', {
                  event: 'final_message_submit',
                  result: 'invalid',
                });
              return remind
                ? {
                    continue: validationError
                      ? `invalid final message ${invalidCount}: ${validationError}`
                      : `Submit valid structured output using ${contract.toolName} or a JSON-only final message matching its schema.`,
                  }
                : undefined;
            },
          }),
        ],
      });
      registry.install(guards);
      harness = await Harness.open(
        connected.storage,
        {
          models: options.models,
          telemetry: options.telemetry ?? createPiTelemetry(),
          registry,
          settings: { toolExecution: 'sequential' },
          env: () => {
            connected.check();
            return prepared?.env;
          },
        },
        context,
      );
      const activeHarness = harness;
      onAbort = () => {
        void activeHarness.close(BACKGROUND_CONTEXT).catch(() => undefined);
      };
      connected.signal.addEventListener('abort', onAbort, { once: true });
      connected.check();
      let state = await harness.snapshot(Attempts, key, context);
      if (state?.result) {
        terminalRecorded = true;
        const result = state.result as unknown as TaskOutput;
        await reporter.finalize(result.usage);
        return result;
      }
      if (state) {
        seed = {
          conversationId: state.conversationId,
          startedAt: state.startedAt,
          baseline: state.baseline,
          ...(state.baselineUsage
            ? { baselineUsage: state.baselineUsage }
            : {}),
        };
        const found = await harness.conversation(
          state.conversationId as ConversationId,
          context,
        );
        if (!found) throw new Error('Durable attempt conversation is missing');
        conversation = found;
      } else {
        const parent = (
          task.input as {
            continueFrom?: { taskId: string; attemptN: number; mode: string };
          }
        ).continueFrom;
        let sourceConversation: Conversation | undefined;
        if (parent) {
          const source = await harness.snapshot(
            Attempts,
            `${parent.taskId}/${parent.attemptN}`,
            context,
          );
          if (!source?.result)
            throw new Error('Parent Durable attempt is not complete');
          sourceConversation = await harness.conversation(
            source.conversationId as ConversationId,
            context,
          );
          if (!sourceConversation)
            throw new Error('Parent Durable conversation is missing');
        }
        // Only obsolete background compaction may cross the continuation boundary.
        // Validate the whole live set before mutating anything or enabling scheduling.
        let live = await harness.inspect(context);
        if (
          sourceConversation &&
          live.submissions.length === 0 &&
          live.tasks.length > 0 &&
          live.tasks.every(
            ({ record }) =>
              record.kind === CompactionTask.definition.name &&
              record.version === CompactionTask.definition.version &&
              record.background === true &&
              record.owner === undefined &&
              record.conversationId === sourceConversation.id,
          )
        ) {
          const ids = live.tasks.map(({ record }) => record.id);
          // abortTask does not enable scheduling. Mark ALL tasks first, so
          // waiting for one cannot resume another task's summarization request.
          for (const id of ids) {
            connected.check();
            await harness.abortTask(id, context);
          }
          for (const id of ids) {
            connected.check();
            const settled = await harness.waitForTask(id, context);
            if (settled.state.outcome.status !== 'aborted')
              throw new Error('Parent background compaction did not abort');
          }
          connected.check();
          live = await harness.inspect(context);
          await emit('info', {
            phase: 'durable_continuation',
            event: 'parent_background_compactions_reconciled',
            conversationId: sourceConversation.id,
            taskCount: ids.length,
            taskIds: ids.slice(0, 20),
          });
        }
        // A new MoltNet attempt cannot adopt another attempt's outstanding work.
        if (live.tasks.length || live.submissions.length) {
          // Keep payloads and raw scheduler errors out of task telemetry. The
          // bounded record identities are enough to locate outstanding work.
          const limit = 20;
          await emit('error', {
            phase: 'durable_continuation',
            event: 'unfinished_parent_work',
            scheduling: live.scheduling,
            taskCount: live.tasks.length,
            submissionCount: live.submissions.length,
            tasks: live.tasks.slice(0, limit).map(({ record, state }) => ({
              id: record.id,
              conversationId: record.conversationId,
              kind: record.kind.slice(0, 120),
              ownerTaskId: record.owner ?? null,
              background: record.background,
              status: record.state.status,
              schedulerState: state.kind,
              ...(state.kind === 'blocked' ? { reason: state.reason } : {}),
            })),
            submissions: live.submissions.slice(0, limit).map((record) => ({
              id: record.id,
              conversationId: record.conversationId,
              type: record.type,
              status: record.status,
            })),
          });
          throw new Error('Parent Durable attempt has unfinished work');
        }
        if (parent && sourceConversation) {
          const found = sourceConversation;
          if (parent.mode === 'fork') {
            const history = await found.entries({}, 1, undefined, context);
            if (!history.items[0])
              throw new Error('Cannot fork an empty conversation');
            conversation = await found.fork(
              history.items[0].id,
              { ownership: { kind: 'ownerless' } },
              context,
            );
          } else conversation = found;
        } else conversation = await harness.root(context);
        const baselineUsage = await harness.usage(context);
        seed = {
          conversationId: conversation.id,
          startedAt: Date.now(),
          baseline: totals(baselineUsage),
          baselineUsage,
        };
        await harness.commit(async (tx) => {
          await tx.doc(Attempts, key, seed);
        }, context);
        state = await harness.snapshot(Attempts, key, context);
      }
      prepared = await connected.prepare(state?.environment ?? null);
      if (!state?.environment && prepared.checkpoint) {
        await harness.commit(async (tx) => {
          (await tx.doc(Attempts, key, seed)).environment =
            prepared!.checkpoint!;
        }, context);
      }
      const guardedTools = (name: string, tools: readonly ToolRegistration[]) =>
        defineExtension({
          name,
          tools: tools.map((tool) => ({
            ...tool,
            async execute(args, api, ctx) {
              connected.check();
              // Pi's safe recovery phase bypasses beforeTool; authorize the actual
              // invocation as well as admission so recovered calls use current policy.
              const block = await prepared!.authorizeTool(
                tool.name,
                args as JsonObject,
                withAbortSignal(connected.signal, ctx),
              );
              if (block)
                return {
                  isError: true,
                  output: [{ type: 'text' as const, text: block }],
                };
              return tool.execute(
                args,
                api,
                withAbortSignal(connected.signal, ctx),
              );
            },
          })),
        });
      for (const extension of [
        ...(prepared.extensions ?? []),
        ...(prepared.subagentExtensions ?? []),
      ]) {
        registry.install({
          ...extension,
          tools: guardedTools(extension.name, extension.tools ?? []).tools,
        });
      }
      const parentTools = [...(prepared.tools ?? [])];
      if (prepared.subagentTools !== undefined) {
        const contracts = options.subagentContracts;
        if (!contracts?.list().length)
          throw new Error('Subagent contracts are required for delegation');
        for (const contract of contracts.list()) {
          const submitChild = defineTool({
            name: 'submit_subagent_output',
            description: contract.description,
            parameters: contract.parametersSchema,
            replay: 'safe',
            executionMode: 'sequential',
            async execute(args, api, ctx) {
              connected.check();
              if (!Value.Check(contract.parametersSchema, args))
                throw new Error('Invalid subagent output');
              await api.commit(async (tx) => {
                const state = await tx.doc(
                  Subagents,
                  String(api.conversationId),
                  null,
                );
                state.output ??= args as JsonObject;
              }, ctx);
              return {
                output: [{ type: 'text', text: 'Output accepted.' }],
                control: { terminate: true },
              };
            },
          });
          registry.install(
            defineExtension({
              name: `moltnet-subagent-${contract.name}`,
              tools: [
                ...guardedTools('inherited', prepared.subagentTools).tools!,
                submitChild,
              ],
              hooks: [
                hook(GenerationTask, {
                  async beforeRequest(_request, api, ctx) {
                    connected.check();
                    let exhausted = false;
                    await activeHarness.commit(async (tx) => {
                      const state = await tx.doc(
                        Subagents,
                        String(api.conversationId),
                        null,
                      );
                      exhausted = state.turns >= (turnLimit ?? 30);
                      if (!exhausted) state.turns += 1;
                    }, ctx);
                    if (exhausted)
                      await abortGeneration(activeHarness, api.taskId, ctx);
                    return undefined;
                  },
                }),
              ],
            }),
          );
        }
        parentTools.push(
          defineTool({
            name: 'subagent',
            description:
              'Delegate a self-contained task to a durable child conversation with a named output contract.',
            parameters: SubagentToolParameters,
            replay: 'safe',
            executionMode: 'sequential',
            async execute(args, api, ctx) {
              connected.check();
              const contract = contracts.get(args.output_schema);
              if (!contract)
                throw new Error(
                  `Unknown subagent output contract: ${args.output_schema}`,
                );
              const childId = await api.commit(async (tx) => {
                const existing = (
                  await tx.scanConversations({ ownerTaskId: api.taskId }, 1)
                ).items[0];
                if (existing) return existing.id;
                const child = await tx.createConversation({
                  ownership: { kind: 'task', taskId: api.taskId },
                });
                await configure(tx, child.id, {
                  ...options.agent,
                  model: options.model,
                  tools: null,
                  instructions: [
                    options.agent?.instructions,
                    prepared!.instructions,
                    'You are a subagent. Complete only the delegated task and call submit_subagent_output.',
                  ]
                    .filter(Boolean)
                    .join('\n\n'),
                  extensions: [
                    registry
                      .snapshot()
                      .extension(`moltnet-subagent-${contract.name}`)!,
                    ...(prepared!.subagentExtensions ?? []).map(
                      (extension) =>
                        registry.snapshot().extension(extension.name)!,
                    ),
                  ],
                });
                return child.id;
              }, ctx);
              await api.details(
                { conversationId: childId, contract: contract.name },
                ctx,
              );
              const child = await api.conversation(childId, ctx);
              if (!child) throw new Error('Subagent conversation is missing');
              await (
                await child.submit(
                  {
                    type: 'input',
                    content: args.task,
                    requestId: `subagent:${api.taskId}`,
                  },
                  ctx,
                )
              ).wait(ctx);
              connected.check();
              const output = (
                await api.snapshot(Subagents, String(childId), ctx)
              )?.output;
              if (!output || !Value.Check(contract.parametersSchema, output))
                throw new Error('Subagent did not submit valid output');
              return {
                output: [{ type: 'text', text: JSON.stringify(output) }],
                details: {
                  captured: true,
                  contract: contract.name,
                  conversationId: childId,
                },
              };
            },
          }),
        );
      }
      const guidance = submitOutputGuidance(task.taskType, contract);
      registry.install({
        ...guardedTools('moltnet-tools', parentTools),
        sections: [
          {
            key: 'task_submission',
            render: () =>
              [guidance.promptSnippet, ...guidance.promptGuidelines].join(
                '\n\n',
              ),
          },
        ],
      });
      await conversation.configure(
        {
          ...options.agent,
          instructions: [options.agent?.instructions, prepared.instructions]
            .filter(Boolean)
            .join('\n\n'),
          model: options.model,
          extensions: [
            guards,
            ...(prepared.extensions ?? []).map(
              (extension) => registry.snapshot().extension(extension.name)!,
            ),
            registry.snapshot().extension('moltnet-tools')!,
          ],
        },
        context,
      );
      connected.check();
      // requestId makes the admission crash window idempotent, including after settlement.
      const submission = await conversation.submit(
        {
          type: 'input',
          requestId: key,
          content:
            prepared.prompt ??
            buildTaskUserPrompt(task, {
              taskId: task.id,
              diaryId: task.diaryId ?? '',
            }).text,
        },
        context,
      );
      const settlement = await submission.wait(context);
      connected.check();
      state = await harness.snapshot(Attempts, key, context);
      const usage = attemptUsage(
        await harness.usage(context),
        seed,
        options.model,
      );
      const durationMs = Date.now() - seed.startedAt;
      const output = state?.submission
        ? materializeTaskOutput(task.taskType, state.submission, {
            usage,
            durationMs,
          })
        : null;
      const errors = output
        ? validateAgentTaskOutput(task.taskType, output, task.input, {
            inputCid: task.inputCid,
          })
        : [];
      const maxTurnsExceeded =
        turnLimit !== undefined && (state?.turns ?? 0) >= turnLimit;
      const bashTimeouts = bashTimeoutsOf(state);
      const maxBashTimeoutsExceeded =
        bashTimeoutLimit !== undefined && bashTimeouts >= bashTimeoutLimit;
      const failure =
        output || state?.finalMessageError
          ? {
              code: 'output_validation_failed',
              message: output
                ? JSON.stringify(errors.slice(0, 3))
                : state!.finalMessageError!,
            }
          : maxBashTimeoutsExceeded
            ? {
                code: 'max_bash_timeouts_exceeded',
                message: `Aborted after ${bashTimeouts} bash timeouts in this attempt (cap ${bashTimeoutLimit}).`,
              }
            : maxTurnsExceeded
              ? {
                  code: 'max_turns_exceeded',
                  message:
                    'Durable task exceeded maxTurns without valid output',
                }
              : {
                  code: 'submit_output_missing',
                  message: 'No valid output was submitted',
                };
      const providerMessage =
        settlement.status === 'unanswered' &&
        settlement.reason === 'model_error'
          ? typeof settlement.detail === 'string'
            ? settlement.detail
            : 'Model generation failed'
          : null;
      const providerVerdict = classifyProviderFailure(providerMessage);
      const providerFailure =
        providerMessage === null
          ? null
          : {
              code: providerVerdict.code,
              retryable: providerVerdict.retryable,
              message: (await redactRetryTriageSecrets(providerMessage)).slice(
                0,
                4000,
              ),
            };
      const result: TaskOutput =
        output && !errors.length
          ? {
              ...base,
              status: 'completed',
              output,
              outputCid: await computeJsonCid(output),
              usage,
              durationMs,
            }
          : {
              ...base,
              status: 'failed',
              output: null,
              outputCid: null,
              usage,
              durationMs,
              error:
                !output && !maxBashTimeoutsExceeded && providerFailure
                  ? providerFailure
                  : { ...failure, retryable: false },
            };
      await harness.commit(async (tx) => {
        (await tx.doc(Attempts, key, seed)).result = JSON.parse(
          JSON.stringify(result),
        ) as JsonObject;
      }, context);
      terminalRecorded = true;
      if (result.status === 'completed') {
        if (state?.outputSource === 'final_message')
          await emit('info', {
            event: 'final_message_submit',
            result: 'captured',
          });
        await emit('info', {
          event: 'output_completion',
          output_source: state?.outputSource ?? 'submit_tool',
        });
      }
      if (result.error)
        await emit('error', {
          phase: 'task_result',
          code: result.error.code,
          message: result.error.message,
        });
      await reporter.finalize(usage);
      return result;
    } catch (error) {
      failed = true;
      if (
        terminalRecorded ||
        (connection?.signal.aborted && !reporter.cancelSignal.aborted)
      )
        throw new TaskExecutionInterrupted(
          'Durable execution interrupted; reconcile the attempt before resuming',
          {
            // Closing the harness rejects pending work with "Harness is closed".
            // Keep the reason that triggered that close (including its cause
            // chain), rather than replacing it with the shutdown symptom.
            cause: connection?.signal.aborted
              ? (connection.signal.reason ?? error)
              : error,
          },
        );
      if (reporterOpen)
        await emit('error', {
          phase: 'durable_execution',
          message: error instanceof Error ? error.message : String(error),
        });
      throw error;
    } finally {
      if (onAbort) connection?.signal.removeEventListener('abort', onAbort);
      // Every step runs even when an earlier one fails. A cleanup failure
      // interrupts an otherwise settled attempt, but never replaces the error
      // that is already propagating.
      const cleanupErrors: TaskExecutionInterrupted[] = [];
      const cleanup = async (message: string, step: () => unknown) => {
        try {
          await step();
        } catch (cause) {
          cleanupErrors.push(new TaskExecutionInterrupted(message, { cause }));
        }
      };
      await cleanup('Durable shutdown interrupted', () =>
        harness?.close(BACKGROUND_CONTEXT).catch((cause: unknown) => {
          // Closing after the writer was lost is expected to fail.
          if (!connection?.signal.aborted) throw cause;
        }),
      );
      await connection?.storage
        .close(BACKGROUND_CONTEXT)
        .catch(() => undefined);
      await cleanup(
        'Durable environment cleanup interrupted; reconcile the attempt',
        () => prepared?.close(),
      );
      await cleanup(
        'Durable reporter cleanup interrupted; reconcile the attempt',
        () => reporter.close(),
      );
      if (failed) {
        for (const error of cleanupErrors)
          process.stderr.write(
            `durable executor: ${error.message} for task ${task.id} attempt ${attemptN} after a failure: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}\n`,
          );
      } else if (cleanupErrors[0]) {
        // eslint-disable-next-line no-unsafe-finally -- a settled attempt whose cleanup failed must be reconciled
        throw cleanupErrors[0];
      }
    }
  };
}
