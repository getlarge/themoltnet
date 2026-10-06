import type { Context } from '@earendil-works/chord';
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from '@earendil-works/chord/context';
import type { Models } from '@earendil-works/pi-ai';
import {
  type AgentChange,
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
  type ToolRegistration,
  ToolTask,
  type UsageState,
} from '@earendil-works/pi-durable';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
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
  validateAgentTaskOutput,
  validateAgentTaskSubmission,
} from '@themoltnet/agent-runtime';
import { Value } from 'typebox/value';

import { SubagentToolParameters } from './runtime/subagent-tool.js';
import {
  formatValidationErrors,
  normalizeSubmitArguments,
  submitOutputGuidance,
} from './runtime/submit-output-tool.js';

const Subagents = defineDocFamily({
  kind: 'moltnet.subagent',
  version: 1,
  scope: 'session',
  family: true,
  initial: (_seed: null) => ({ output: null as JsonObject | null, turns: 0 }),
});

const Attempts = defineDocFamily({
  kind: 'moltnet.attempt',
  version: 1,
  scope: 'session',
  family: true,
  initial: (seed: {
    conversationId: number;
    startedAt: number;
    baseline: TaskUsage;
  }) => ({
    ...seed,
    submission: null as JsonObject | null,
    result: null as JsonObject | null,
    environment: null as JsonObject | null,
    turns: 0,
    reminders: 0,
  }),
});

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

/** No filesystem artifacts: this executor's complete continuation state lives in Storage. */
export function createDurableTaskExecutor(options: {
  models: Models;
  model: { provider: string; modelId: string };
  agent?: Omit<AgentChange, 'model'>;
  maxTurns?: number;
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
    try {
      connection = await options.open(claimed, reporter.cancelSignal);
      await reporter.open(base);
      const connected = connection;
      const context = withAbortSignal(connected.signal, BACKGROUND_CONTEXT);
      const registry = createRegistry();
      let conversation: Conversation;
      const submit = defineTool({
        name: contract.toolName,
        description: contract.description,
        parameters: contract.parametersSchema,
        constrainedSampling: { type: 'json_schema', strict: 'prefer' },
        prepareArguments(args) {
          try {
            return normalizeSubmitArguments(
              task.taskType,
              args,
              contract.parametersSchema,
              contract.toolName,
              contract.description,
              { input: task.input, inputCid: task.inputCid },
            ).candidate as JsonObject;
          } catch (error) {
            const errors = validateAgentTaskSubmission(
              task.taskType,
              args,
              task.input,
              { inputCid: task.inputCid },
            );
            throw new Error(
              `Output failed validation: ${errors.length ? formatValidationErrors(errors) : String(error)}. Re-call this tool with corrected output.`,
            );
          }
        },
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
              content: [
                { type: 'text', text: JSON.stringify(errors.slice(0, 3)) },
              ],
            };
          await api.commit(async (tx) => {
            const state = await tx.doc(Attempts, key, seed);
            if (state.submission === null)
              state.submission = args as JsonObject;
          }, ctx);
          return {
            content: [{ type: 'text', text: 'Output accepted.' }],
            control: { terminate: true },
          };
        },
      });
      let seed = {
        conversationId: 1,
        startedAt: Date.now(),
        baseline: { inputTokens: 0, outputTokens: 0 } as TaskUsage,
      };
      const guards = defineExtension({
        name: 'moltnet-attempt',
        tools: [submit],
        hooks: [
          hook(ToolTask, {
            async beforeTool(call, _api, ctx) {
              connected.check();
              if (call.name === contract.toolName) return;
              const block = await prepared!.authorizeTool(
                call.name,
                call.arguments as JsonObject,
                withAbortSignal(connected.signal, ctx),
              );
              return block ? { block } : undefined;
            },
          }),
          hook(GenerationTask, {
            async beforeRequest(_request, api, ctx) {
              connected.check();
              let exhausted = false;
              await harness!.commit(async (tx) => {
                const state = await tx.doc(Attempts, key, seed);
                exhausted =
                  !!options.maxTurns && state.turns >= options.maxTurns;
                if (!exhausted) state.turns += 1;
              }, context);
              if (exhausted) {
                await abortGeneration(harness!, api.taskId, ctx);
              }
              return undefined;
            },
            async onYield() {
              connected.check();
              let remind = false;
              await harness!.commit(async (tx) => {
                const state = await tx.doc(Attempts, key, seed);
                if (
                  !state.submission &&
                  state.reminders < (options.maxSubmitReminders ?? 3)
                ) {
                  state.reminders += 1;
                  remind = true;
                }
              }, context);
              return remind
                ? {
                    continue: `Remember: the only way to finish is to call the tool ${contract.toolName} with valid structured output.`,
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
        };
        const found = await harness.conversation(
          state.conversationId as ConversationId,
          context,
        );
        if (!found) throw new Error('Durable attempt conversation is missing');
        conversation = found;
      } else {
        // A new MoltNet attempt cannot adopt another attempt's outstanding work.
        const live = await harness.inspect(context);
        if (live.tasks.length || live.submissions.length)
          throw new Error('Parent Durable attempt has unfinished work');
        const parent = (
          task.input as {
            continueFrom?: { taskId: string; attemptN: number; mode: string };
          }
        ).continueFrom;
        if (parent) {
          const source = await harness.snapshot(
            Attempts,
            `${parent.taskId}/${parent.attemptN}`,
            context,
          );
          if (!source?.result)
            throw new Error('Parent Durable attempt is not complete');
          const found = await harness.conversation(
            source.conversationId as ConversationId,
            context,
          );
          if (!found) throw new Error('Parent Durable conversation is missing');
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
        seed = {
          conversationId: conversation.id,
          startedAt: Date.now(),
          baseline: totals(await harness.usage(context)),
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
                  content: [{ type: 'text' as const, text: block }],
                };
              return tool.execute(
                args,
                api,
                withAbortSignal(connected.signal, ctx),
              );
            },
          })),
        });
      for (const extension of prepared.extensions ?? []) {
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
                content: [{ type: 'text', text: 'Output accepted.' }],
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
                      exhausted = state.turns >= (options.maxTurns || 30);
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
                content: [{ type: 'text', text: JSON.stringify(output) }],
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
      await submission.wait(context);
      connected.check();
      state = await harness.snapshot(Attempts, key, context);
      const total = totals(await harness.usage(context));
      const usage: TaskUsage = {
        inputTokens: total.inputTokens - seed.baseline.inputTokens,
        outputTokens: total.outputTokens - seed.baseline.outputTokens,
        cacheReadTokens:
          (total.cacheReadTokens ?? 0) - (seed.baseline.cacheReadTokens ?? 0),
        cacheWriteTokens:
          (total.cacheWriteTokens ?? 0) - (seed.baseline.cacheWriteTokens ?? 0),
        provider: options.model.provider,
        model: options.model.modelId,
      };
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
        options.maxTurns !== undefined &&
        (state?.turns ?? 0) >= options.maxTurns;
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
              error: {
                code: output
                  ? 'output_validation_failed'
                  : maxTurnsExceeded
                    ? 'max_turns_exceeded'
                    : 'submit_output_missing',
                message: output
                  ? JSON.stringify(errors.slice(0, 3))
                  : maxTurnsExceeded
                    ? 'Durable task exceeded maxTurns without valid output'
                    : 'No valid output was submitted',
                retryable: false,
              },
            };
      await harness.commit(async (tx) => {
        (await tx.doc(Attempts, key, seed)).result = JSON.parse(
          JSON.stringify(result),
        ) as JsonObject;
      }, context);
      terminalRecorded = true;
      await reporter.finalize(usage);
      return result;
    } catch (error) {
      if (
        terminalRecorded ||
        (connection?.signal.aborted && !reporter.cancelSignal.aborted)
      )
        throw new TaskExecutionInterrupted(
          'Durable execution interrupted; attempt remains resumable',
          { cause: error },
        );
      throw error;
    } finally {
      if (onAbort) connection?.signal.removeEventListener('abort', onAbort);
      try {
        try {
          await harness?.close(BACKGROUND_CONTEXT).catch((cause: unknown) => {
            if (!connection?.signal.aborted)
              throw new TaskExecutionInterrupted(
                'Durable shutdown interrupted',
                { cause },
              );
          });
        } finally {
          await connection?.storage
            .close(BACKGROUND_CONTEXT)
            .catch(() => undefined);
        }
      } finally {
        try {
          await Promise.resolve(prepared?.close()).catch((cause: unknown) => {
            throw new TaskExecutionInterrupted(
              'Durable environment cleanup interrupted; reconcile the attempt',
              { cause },
            );
          });
        } finally {
          await Promise.resolve(reporter.close()).catch((cause: unknown) => {
            throw new TaskExecutionInterrupted(
              'Durable reporter cleanup interrupted; reconcile the attempt',
              { cause },
            );
          });
        }
      }
    }
  };
}
