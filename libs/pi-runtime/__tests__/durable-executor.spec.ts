import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  Type,
} from '@earendil-works/pi-ai';
import { createProvider } from '@earendil-works/pi-ai/models';
import {
  type CompactionResult,
  CompactionTask,
  type ConversationId,
  createRegistry,
  defineExtension,
  defineTool,
  type Extension,
  Harness,
  LiveDoc,
  type StorageWrite,
  type SubmissionId,
  type TaskId,
  type ToolRegistration,
} from '@earendil-works/pi-durable';
import type { TelemetryContext } from '@earendil-works/pi-telemetry';
import { propagation, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  AgentRuntime,
  ApiTaskReporter,
  type ClaimedTask,
  createSubagentContractRegistry,
  TaskExecutionInterrupted,
  type TaskReporter,
} from '@themoltnet/agent-runtime';
import type { RuntimeSessionsNamespace, TasksNamespace } from '@themoltnet/sdk';
import { describe, expect, it, type Mock, vi } from 'vitest';

import { createDurableTaskExecutor } from '../src/durable-executor.js';
import { ApiDurableStorage } from '../src/durable-storage.js';
import { acquireDurableTransport } from '../src/durable-transport.js';
import { createPiTelemetry } from '../src/otel/durable.js';
import { piCodemode } from '../src/runtime-definition.js';
import { remoteLog } from './durable-log.js';

function task(
  id = 'aaaaaaaa-0000-4000-8000-000000000001',
  input: object = { brief: 'Do it' },
): ClaimedTask {
  return {
    task: {
      id,
      teamId: 'team',
      taskType: 'freeform',
      input,
      inputCid: 'bafy-input',
    },
    attemptN: 1,
    traceHeaders: {},
  } as ClaimedTask;
}
function reporter(): TaskReporter & {
  record: Mock<TaskReporter['record']>;
  close: Mock<TaskReporter['close']>;
} {
  return {
    open: vi.fn(),
    record: vi.fn<TaskReporter['record']>(),
    finalize: vi.fn(),
    close: vi.fn<TaskReporter['close']>(),
    cancelReason: null,
    cancelSignal: new AbortController().signal,
  };
}
function recorded(events: ReturnType<typeof reporter>) {
  return events.record.mock.calls.map(([message]) => message);
}
function setup(
  subagents = false,
  maxTurns?: number,
  subagentExtensions?: readonly Extension[],
  overrides: {
    telemetry?: TelemetryContext;
    maxBashTimeouts?: number;
    tools?: readonly ToolRegistration[];
    extensions?: readonly Extension[];
  } = {},
) {
  const allowed = new Set([
    'subagent',
    ...(overrides.extensions ?? []).flatMap((extension) =>
      (extension.tools ?? []).map((tool) => tool.name),
    ),
    ...(overrides.tools ?? []).map((tool) => tool.name),
  ]);
  const remote = remoteLog();
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const models = createModels();
  models.setProvider(faux.provider);
  const prepare = vi.fn(async () => ({
    authorizeTool: vi.fn(async (name: string) =>
      allowed.has(name) ? undefined : 'blocked',
    ),
    ...(overrides.tools ? { tools: overrides.tools } : {}),
    extensions: overrides.extensions,
    ...(subagents ? { subagentTools: [] } : {}),
    subagentExtensions,
    close: vi.fn(),
  }));
  const execute = createDurableTaskExecutor({
    models,
    telemetry: overrides.telemetry,
    maxTurns,
    maxBashTimeouts: overrides.maxBashTimeouts,
    subagentContracts: createSubagentContractRegistry([
      {
        name: 'verdict',
        description: 'Return a verdict',
        parametersSchema: Type.Object({ verdict: Type.String() }),
      },
    ]),
    model: { provider: faux.provider.id, modelId: faux.models[0].id },
    open: async (_claimed, signal) => ({
      storage: await ApiDurableStorage.open(
        remote.transport,
        BACKGROUND_CONTEXT,
      ),
      signal,
      check: () => signal.throwIfAborted(),
      prepare,
    }),
  });
  return { ...remote, faux, models, execute, prepare };
}
// Synthetic pending summarize state: no production transcript or raw log.
async function pendingCompactions(
  fixture: ReturnType<typeof setup>,
  overrides: Partial<
    Pick<
      Extract<StorageWrite, { type: 'task' }>['value'],
      'background' | 'kind' | 'conversationId' | 'owner' | 'version'
    >
  > = {},
  count = 2,
) {
  const storage = await ApiDurableStorage.open(
    fixture.transport,
    BACKGROUND_CONTEXT,
  );
  const history = await storage.scanEntries(
    { conversationId: 1 as ConversationId },
    100,
    undefined,
    BACKGROUND_CONTEXT,
  );
  const ids: TaskId<CompactionResult>[] = [];
  for (let n = 0; n < count; n++) {
    const id = await storage.mintId<TaskId<CompactionResult>>();
    ids.push(id);
    await storage.commit(
      [
        {
          type: 'task',
          value: {
            id,
            conversationId: 1 as ConversationId,
            kind: CompactionTask.definition.name,
            version: CompactionTask.definition.version,
            background: true,
            abortRequested: false,
            input: { reason: 'threshold' },
            state: {
              status: 'pending',
              checkpoint: {
                phase: 'summarize',
                attempt: 1,
                model: {
                  provider: fixture.faux.provider.id,
                  modelId: fixture.faux.models[0].id,
                },
                thinkingLevel: 'off',
                streamOptions: {},
                maxTokens: 128,
                tail: history.items[0].id,
                firstKept: history.items[1].id,
              },
            },
            ...overrides,
          },
        },
      ],
      BACKGROUND_CONTEXT,
    );
  }
  const harness = await Harness.open(
    storage,
    {
      models: fixture.models,
      registry: createRegistry(),
    },
    BACKGROUND_CONTEXT,
  );
  await harness.commit(async (tx) => {
    const live = await tx.doc(LiveDoc, 1 as ConversationId);
    live.compactions = ids.map((taskId) => ({
      taskId,
      reason: 'threshold',
      blocking: false,
      attempt: 1,
    }));
  }, BACKGROUND_CONTEXT);
  await harness.close(BACKGROUND_CONTEXT);
  return ids;
}
const continuation = (mode?: string) =>
  task('aaaaaaaa-0000-4000-8000-000000000002', {
    brief: 'Continue',
    continueFrom: {
      taskId: task().task.id,
      attemptN: 1,
      ...(mode ? { mode } : {}),
    },
  });

/** A `bash` stand-in that fails the way the Durable bash tool does. */
function failingBash(message: string) {
  const execute = vi.fn(async (): Promise<never> => {
    throw new Error(message);
  });
  return {
    execute,
    tool: defineTool({
      name: 'bash',
      description: 'Run a command',
      parameters: Type.Object({ command: Type.String() }),
      execute,
    }),
  };
}
const bashCall = (command: string) =>
  fauxAssistantMessage(fauxToolCall('bash', { command }), {
    stopReason: 'toolUse',
  });
const submitted = () =>
  fauxAssistantMessage(
    fauxToolCall('submit_freeform_output', { summary: 'Done' }),
    { stopReason: 'toolUse' },
  );

describe('Durable task integration', () => {
  it.each([
    ['503 Service unavailable', 'llm_api_error', true],
    ['401 Unauthorized', 'llm_auth_error', false],
    ['400 Unsupported parameter: temperature', 'llm_request_rejected', false],
  ])(
    'preserves the terminal provider verdict for %s',
    async (message, code, retryable) => {
      vi.useFakeTimers();
      try {
        const { faux, execute } = setup();
        faux.setResponses(
          Array.from({ length: 20 }, () =>
            fauxAssistantMessage('', {
              stopReason: 'error',
              errorMessage: message,
            }),
          ),
        );
        const pending = execute(task(), reporter());
        await vi.runAllTimersAsync();
        const result = await pending;
        expect(result.error).toMatchObject({ code, retryable, message });
        const calls = faux.state.callCount;
        if (retryable) expect(calls).toBeGreaterThan(1);
        expect(await execute(task(), reporter())).toEqual(result);
        expect(faux.state.callCount).toBe(calls);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('includes submission schema and finality guidance in the model prompt', async () => {
    const { faux, execute } = setup();
    let prompt = '';
    faux.setResponses([
      (context) => {
        prompt = context.messages
          .filter((message) => message.role === 'system')
          .map((message) =>
            [message.content, ...Object.values(message.sections ?? {})].join(
              '\n',
            ),
          )
          .join('\n');
        return submitted();
      },
    ]);
    expect((await execute(task(), reporter())).status).toBe('completed');
    expect(prompt).toContain('Agent submission schema:');
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('The first valid submission is final');
    expect(prompt).toContain('Omit optional fields when they do not apply');
    expect(prompt).toContain(
      'Include branch only when the task used a Git branch',
    );
  });

  it('normalizes strict-mode nulls and records submit-gate verification durably', async () => {
    const { faux, execute } = setup();
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('submit_freeform_output', {
          summary: 'Done',
          verification: null,
        }),
        { stopReason: 'toolUse' },
      ),
    ]);
    const claimed = task(undefined, {
      brief: 'Do it',
      successCriteria: {
        version: 1,
        gates: [
          {
            id: 'submit-output',
            kind: 'submit-tool-call',
            description: 'Submit valid output',
            required: true,
          },
        ],
      },
    });
    const result = await execute(claimed, reporter());
    expect(result.status).toBe('completed');
    expect(result.output).toHaveProperty('verification.passed', true);
    expect(result.output).toHaveProperty('verification.inputCid', 'bafy-input');
    expect(await execute(claimed, reporter())).toEqual(result);
    expect(faux.state.callCount).toBe(1);
  });

  it.each(['raw', 'fenced'])(
    'accepts %s JSON and persists the normalized submission',
    async (format) => {
      const { faux, execute } = setup(false, 1);
      const json = JSON.stringify({ summary: 'Done', verification: null });
      faux.setResponses([
        fauxAssistantMessage(
          format === 'raw' ? json : '```json\n' + json + '\n```',
        ),
      ]);
      const claimed = task(undefined, {
        brief: 'Do it',
        successCriteria: {
          version: 1,
          gates: [
            {
              id: 'submit-output',
              kind: 'submit-tool-call',
              description: 'Submit valid output',
              required: true,
            },
          ],
        },
      });
      const events = reporter();
      const result = await execute(claimed, events);
      expect(result.status).toBe('completed');
      expect(result.output).toHaveProperty('summary', 'Done');
      expect(result.output).toHaveProperty(
        'verification.inputCid',
        'bafy-input',
      );
      expect(recorded(events)).toContainEqual({
        kind: 'info',
        payload: { event: 'output_completion', output_source: 'final_message' },
      });
      expect(
        recorded(events).some(({ kind }) => kind.startsWith('tool_')),
      ).toBe(false);
      expect(await execute(claimed, reporter())).toEqual(result);
      expect(faux.state.callCount).toBe(1);
    },
  );

  it('retries invalid JSON independently of the tool-turn limit and accepts correction', async () => {
    const { faux, execute } = setup(false, 1);
    faux.setResponses([
      fauxAssistantMessage('{"summary":"Done","result":{}}'),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          'invalid final message 1',
        );
        return fauxAssistantMessage(
          '{"summary":"Corrected","result":{"answer":"yes"}}',
        );
      },
    ]);
    expect(
      (
        await execute(
          task(undefined, {
            brief: 'Do it',
            outputContract: {
              version: 1,
              schema: {
                type: 'object',
                properties: { answer: { type: 'string' } },
                required: ['answer'],
                additionalProperties: false,
              },
            },
          }),
          reporter(),
        )
      ).output,
    ).toHaveProperty('summary', 'Corrected');
    expect(faux.state.callCount).toBe(2);
  });

  it.each([
    '{"summary":"Done","result":{}}',
    'Here is the output: {"summary":"Done"}',
    '[{"summary":"Done"}]',
  ])('bounds rejected final messages: %s', async (text) => {
    const { faux, execute } = setup(false, 1);
    faux.setResponses(
      Array.from({ length: 4 }, () => fauxAssistantMessage(text)),
    );
    const claimed = task(undefined, {
      brief: 'Do it',
      outputContract: {
        version: 1,
        schema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
          additionalProperties: false,
        },
      },
    });
    const result = await execute(claimed, reporter());
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe(
      text.startsWith('{')
        ? 'output_validation_failed'
        : 'submit_output_missing',
    );
    if (text.startsWith('{'))
      expect(result.error?.message).toContain('output/result/answer');
    expect(faux.state.callCount).toBe(4);
    expect(await execute(claimed, reporter())).toEqual(result);
    expect(faux.state.callCount).toBe(4);
  });

  it('reports the durable generation limit when no output was submitted', async () => {
    const { faux, execute } = setup(false, 2);
    faux.setResponses([bashCall('pwd'), bashCall('pwd')]);
    const result = await execute(task(), reporter());
    expect(result.error?.code).toBe('max_turns_exceeded');
    expect(faux.state.callCount).toBe(2);
    expect(await execute(task(), reporter())).toEqual(result);
  });

  it('ends the attempt once bash timeouts reach the cap', async () => {
    const bash = failingBash('Command timed out after 5 seconds');
    const { faux, execute } = setup(false, undefined, undefined, {
      maxBashTimeouts: 2,
      tools: [bash.tool],
    });
    faux.setResponses([
      bashCall('sleep 60'),
      bashCall('sleep 61'),
      submitted(),
    ]);
    const events = reporter();

    const result = await execute(task(), events);

    expect(bash.execute).toHaveBeenCalledTimes(2);
    expect(faux.state.callCount).toBe(2);
    expect(result.status).toBe('failed');
    expect(result.error).toEqual({
      code: 'max_bash_timeouts_exceeded',
      message: 'Aborted after 2 bash timeouts in this attempt (cap 2).',
      retryable: false,
    });
    expect(recorded(events)).toContainEqual({
      kind: 'error',
      payload: {
        phase: 'task_result',
        code: 'max_bash_timeouts_exceeded',
        message: 'Aborted after 2 bash timeouts in this attempt (cap 2).',
      },
    });
    expect(await execute(task(), reporter())).toEqual(result);
  });

  it('tells the model to submit when few tool rounds remain', async () => {
    const bash = failingBash('Command exited with code 1');
    const { faux, execute } = setup(false, 5, undefined, {
      tools: [bash.tool],
    });
    const notices: string[][] = [];
    const respond =
      (reply: () => ReturnType<typeof submitted>) =>
      (context: {
        messages: readonly { role: string; content: unknown }[];
      }) => {
        notices.push(
          context.messages
            .filter((message) => message.role === 'user')
            .map((message) => JSON.stringify(message.content))
            .filter((content) => content.includes('Runtime notice')),
        );
        return reply();
      };
    faux.setResponses([
      respond(() => bashCall('ls')),
      respond(() => bashCall('ls')),
      respond(() => bashCall('ls')),
      respond(submitted),
    ]);

    const result = await execute(task(), reporter());

    expect(result.status).toBe('completed');
    // Five rounds allowed: the notice starts once three remain, and only the
    // current request carries it.
    expect(notices.map((found) => found.length)).toEqual([0, 0, 1, 1]);
    expect(notices[2][0]).toContain('3 tool rounds left');
    expect(notices[2][0]).toContain('call submit_freeform_output now');
    expect(notices[3][0]).toContain('2 tool rounds left');
  });

  it('counts only bash timeouts toward the cap', async () => {
    const bash = failingBash('Command exited with code 1');
    const { faux, execute } = setup(false, undefined, undefined, {
      maxBashTimeouts: 1,
      tools: [bash.tool],
    });
    faux.setResponses([bashCall('false'), bashCall('false'), submitted()]);

    const result = await execute(task(), reporter());

    expect(bash.execute).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('completed');
  });

  it('disables the bash-timeout cap at zero', async () => {
    const bash = failingBash('Command timed out after 5 seconds');
    const { faux, execute } = setup(false, undefined, undefined, {
      maxBashTimeouts: 0,
      tools: [bash.tool],
    });
    faux.setResponses([
      bashCall('sleep 60'),
      bashCall('sleep 61'),
      bashCall('sleep 62'),
      bashCall('sleep 63'),
      submitted(),
    ]);

    const result = await execute(task(), reporter());

    expect(bash.execute).toHaveBeenCalledTimes(4);
    expect(result.status).toBe('completed');
  });

  it('enforces the generation limit inside delegated tool loops', async () => {
    const { faux, execute } = setup(true, 1);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('subagent', {
          task: 'Inspect the change',
          output_schema: 'verdict',
        }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        fauxToolCall('submit_subagent_output', { verdict: 42 }),
        { stopReason: 'toolUse' },
      ),
    ]);
    const result = await execute(task(), reporter());
    expect(result.error?.code).toBe('max_turns_exceeded');
    expect(faux.state.callCount).toBe(2);
  });

  it('installs child extensions and guards their tools', async () => {
    const executeChildTool = vi.fn(async () => ({
      output: [{ type: 'text' as const, text: 'unreachable' }],
    }));
    const extension = defineExtension({
      name: 'child-probe',
      tools: [
        defineTool({
          name: 'child_probe',
          description: 'Probe a child tool',
          parameters: Type.Object({}),
          replay: 'safe',
          executionMode: 'sequential',
          execute: executeChildTool,
        }),
      ],
    });
    const { faux, execute } = setup(true, undefined, [extension]);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('subagent', {
          task: 'Inspect the change',
          output_schema: 'verdict',
        }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(fauxToolCall('child_probe', {}), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage(
        fauxToolCall('submit_subagent_output', { verdict: 'safe' }),
        { stopReason: 'toolUse' },
      ),
      submitted(),
    ]);

    expect((await execute(task(), reporter())).status).toBe('completed');
    expect(executeChildTool).not.toHaveBeenCalled();
    expect(faux.state.callCount).toBe(4);
  });

  it('persists the validated output and reconciles a fresh executor without another model call or VM', async () => {
    const { faux, execute, prepare } = setup();
    faux.setResponses([submitted()]);
    const result = await execute(task(), reporter());
    expect(result.status).toBe('completed');
    expect(result.output).toEqual({ summary: 'Done' });
    expect(result.outputCid).toBeTruthy();
    expect(await execute(task(), reporter())).toEqual(result);
    expect(faux.state.callCount).toBe(1);
    expect(prepare).toHaveBeenCalledOnce();
  });
  it.each(['extend', 'fork'])(
    'continues through %s with attempt-local usage and idempotent admission',
    async (mode) => {
      const { faux, execute } = setup();
      faux.setResponses([submitted(), submitted()]);
      const parent = await execute(task(), reporter());
      const child = await execute(
        task('aaaaaaaa-0000-4000-8000-000000000002', {
          brief: 'Continue',
          continueFrom: {
            taskId: 'aaaaaaaa-0000-4000-8000-000000000001',
            attemptN: 1,
            mode,
          },
        }),
        reporter(),
      );
      expect(parent.status).toBe('completed');
      expect(child.status).toBe('completed');
      expect(faux.state.callCount).toBe(2);
      expect(child.usage.inputTokens).toBeGreaterThan(0);
      // The child's per-model split carries only its own call.
      expect(child.usage.models).toEqual([
        expect.objectContaining({
          provider: faux.provider.id,
          model: faux.models[0].id,
          inputTokens: child.usage.inputTokens,
          outputTokens: child.usage.outputTokens,
        }),
      ]);
    },
  );
  it.each(['extend', 'fork'])(
    'continues through %s after the parent corrects an invalid submission',
    async (mode) => {
      const { faux, execute, transport } = setup();
      const append = transport.append;
      transport.append = async (input, context) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 1);
        });
        return append(input, context);
      };
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall('submit_freeform_output', {
            summary: 'Invalid',
            result: {},
          }),
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage(
          fauxToolCall('submit_freeform_output', {
            summary: 'Corrected',
            result: { answer: 'yes' },
          }),
          { stopReason: 'toolUse' },
        ),
        submitted(),
      ]);
      const parent = await execute(
        task(undefined, {
          brief: 'Do it',
          outputContract: {
            version: 1,
            schema: {
              type: 'object',
              properties: { answer: { type: 'string' } },
              required: ['answer'],
              additionalProperties: false,
            },
          },
        }),
        reporter(),
      );
      expect(parent.status).toBe('completed');
      const child = await execute(
        task('aaaaaaaa-0000-4000-8000-000000000002', {
          brief: 'Correct the domain-invalid output',
          continueFrom: {
            taskId: 'aaaaaaaa-0000-4000-8000-000000000001',
            attemptN: 1,
            mode,
          },
        }),
        reporter(),
      );
      expect(child.status).toBe('completed');
      expect(faux.state.callCount).toBe(3);
    },
  );
  it.each([undefined, 'extend', 'fork'])(
    'reconciles pending background compactions for %s without model spend or history loss',
    async (mode) => {
      const fixture = setup();
      fixture.faux.setResponses([submitted(), submitted()]);
      const parent = await fixture.execute(task(), reporter());
      const ids = await pendingCompactions(fixture);
      const before = await ApiDurableStorage.open(
        fixture.transport,
        BACKGROUND_CONTEXT,
      );
      const history = await before.scanEntries(
        { conversationId: 1 as ConversationId },
        100,
        undefined,
        BACKGROUND_CONTEXT,
      );
      const beforeHarness = await Harness.open(
        before,
        { models: fixture.models, registry: createRegistry() },
        BACKGROUND_CONTEXT,
      );
      const usageBefore = await beforeHarness.usage(BACKGROUND_CONTEXT);
      await beforeHarness.close(BACKGROUND_CONTEXT);
      // A replay of the same completed attempt still returns its persisted result.
      expect(await fixture.execute(task(), reporter())).toEqual(parent);
      fixture.prepare.mockImplementationOnce(async () => {
        // Cleanup has completed before environment preparation or another model call.
        expect(fixture.faux.state.callCount).toBe(1);
        const storage = await ApiDurableStorage.open(
          fixture.transport,
          BACKGROUND_CONTEXT,
        );
        for (const id of ids)
          expect(
            (await storage.task(id, BACKGROUND_CONTEXT))?.state,
          ).toMatchObject({
            status: 'terminal',
            outcome: { status: 'aborted' },
          });
        const harness = await Harness.open(
          storage,
          { models: fixture.models, registry: createRegistry() },
          BACKGROUND_CONTEXT,
        );
        expect(
          (
            await harness.snapshot(
              LiveDoc,
              1 as ConversationId,
              BACKGROUND_CONTEXT,
            )
          )?.compactions,
        ).toBeUndefined();
        expect(await harness.usage(BACKGROUND_CONTEXT)).toEqual(usageBefore);
        expect((await harness.inspect(BACKGROUND_CONTEXT)).tasks).toEqual([]);
        const after = await storage.scanEntries(
          { conversationId: 1 as ConversationId },
          100,
          undefined,
          BACKGROUND_CONTEXT,
        );
        expect(after).toEqual(history);
        await harness.close(BACKGROUND_CONTEXT);
        return {
          authorizeTool: vi.fn(async () => undefined),
          extensions: undefined,
          subagentExtensions: undefined,
          close: vi.fn(),
        };
      });
      const events = reporter();
      const child = await fixture.execute(continuation(mode), events);
      expect(child.status).toBe('completed');
      expect(child.usage.outputTokens).toBe(parent.usage.outputTokens);
      expect(child.usage.models).toEqual([
        expect.objectContaining({
          inputTokens: child.usage.inputTokens,
          outputTokens: child.usage.outputTokens,
        }),
      ]);
      expect(fixture.faux.state.callCount).toBe(2);
      expect(recorded(events)).toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            event: 'parent_background_compactions_reconciled',
            taskCount: 2,
          }),
        }),
      );
      expect(await fixture.execute(continuation(mode), reporter())).toEqual(
        child,
      );
      expect(fixture.faux.state.callCount).toBe(2);
    },
  );

  it.each([
    { background: false },
    { kind: 'other.background' },
    { conversationId: 999 as ConversationId },
    { owner: 999 as TaskId },
    { version: CompactionTask.definition.version + 1 },
  ])(
    'rejects ineligible compaction %j without cleaning eligible work',
    async (override) => {
      const fixture = setup();
      fixture.faux.setResponses([submitted()]);
      await fixture.execute(task(), reporter());
      const eligible = await pendingCompactions(fixture);
      await pendingCompactions(fixture, override, 1);
      await expect(fixture.execute(continuation(), reporter())).rejects.toThrow(
        'Parent Durable attempt has unfinished work',
      );
      const storage = await ApiDurableStorage.open(
        fixture.transport,
        BACKGROUND_CONTEXT,
      );
      for (const id of eligible)
        expect(
          (await storage.task(id, BACKGROUND_CONTEXT))?.abortRequested,
        ).toBe(false);
      await storage.close(BACKGROUND_CONTEXT);
      expect(fixture.prepare).toHaveBeenCalledOnce();
      expect(fixture.faux.state.callCount).toBe(1);
    },
  );

  it('rejects compaction alongside an unsettled submission', async () => {
    const fixture = setup();
    fixture.faux.setResponses([submitted()]);
    await fixture.execute(task(), reporter());
    const ids = await pendingCompactions(fixture);
    const storage = await ApiDurableStorage.open(
      fixture.transport,
      BACKGROUND_CONTEXT,
    );
    await storage.commit(
      [
        {
          type: 'submission',
          value: {
            id: await storage.mintId<SubmissionId>(),
            conversationId: 1 as ConversationId,
            type: 'input',
            status: 'queued',
          },
        },
      ],
      BACKGROUND_CONTEXT,
    );
    await storage.close(BACKGROUND_CONTEXT);
    await expect(fixture.execute(continuation(), reporter())).rejects.toThrow(
      'Parent Durable attempt has unfinished work',
    );
    const reopened = await ApiDurableStorage.open(
      fixture.transport,
      BACKGROUND_CONTEXT,
    );
    for (const id of ids)
      expect(
        (await reopened.task(id, BACKGROUND_CONTEXT))?.abortRequested,
      ).toBe(false);
    await reopened.close(BACKGROUND_CONTEXT);
    expect(fixture.prepare).toHaveBeenCalledOnce();
    expect(fixture.faux.state.callCount).toBe(1);
  });

  it.each([
    'cancel-mark',
    'storage-mark',
    'cancel-settlement',
    'storage-settlement',
  ] as const)(
    'recovers idempotently after %s interrupts compaction cleanup',
    async (failure) => {
      const fixture = setup();
      fixture.faux.setResponses([submitted(), submitted()]);
      await fixture.execute(task(), reporter());
      const ids = await pendingCompactions(fixture);
      const append = fixture.transport.append;
      const controller = new AbortController();
      const interruption = new Error('cleanup interrupted');
      let marked = false;
      fixture.transport.append = async (input, context) => {
        const marks = input.writes.some(
          (write) =>
            write.type === 'task' &&
            ids.some((id) => id === write.value.id) &&
            write.value.abortRequested &&
            (failure.endsWith('settlement')
              ? write.value.state.status === 'terminal'
              : write.value.state.status !== 'terminal'),
        );
        if (marks && !marked) {
          marked = true;
          if (failure.startsWith('storage')) throw interruption;
          const result = await append(input, context);
          controller.abort(interruption);
          return result;
        }
        return append(input, context);
      };
      const events = { ...reporter(), cancelSignal: controller.signal };
      await expect(fixture.execute(continuation(), events)).rejects.toThrow();
      expect(marked).toBe(true);
      expect(fixture.prepare).toHaveBeenCalledOnce();
      expect(fixture.faux.state.callCount).toBe(1);
      fixture.transport.append = append;
      expect((await fixture.execute(continuation(), reporter())).status).toBe(
        'completed',
      );
      expect(fixture.faux.state.callCount).toBe(2);
      const storage = await ApiDurableStorage.open(
        fixture.transport,
        BACKGROUND_CONTEXT,
      );
      for (const id of ids)
        expect(
          (await storage.task(id, BACKGROUND_CONTEXT))?.state,
        ).toMatchObject({ status: 'terminal', outcome: { status: 'aborted' } });
      await storage.close(BACKGROUND_CONTEXT);
    },
  );

  it('validates the parent before mutating inherited compaction', async () => {
    const fixture = setup();
    fixture.faux.setResponses([submitted()]);
    await fixture.execute(task(), reporter());
    const ids = await pendingCompactions(fixture);
    await expect(
      fixture.execute(
        task('new-task', {
          brief: 'Continue',
          continueFrom: { taskId: 'missing-parent', attemptN: 1 },
        }),
        reporter(),
      ),
    ).rejects.toThrow('Parent Durable attempt is not complete');
    const storage = await ApiDurableStorage.open(
      fixture.transport,
      BACKGROUND_CONTEXT,
    );
    for (const id of ids)
      expect((await storage.task(id, BACKGROUND_CONTEXT))?.abortRequested).toBe(
        false,
      );
    await storage.close(BACKGROUND_CONTEXT);
    expect(fixture.prepare).toHaveBeenCalledOnce();
    expect(fixture.faux.state.callCount).toBe(1);
  });

  it.each(['tasks', 'submissions'] as const)(
    'rejects outstanding %s with bounded, payload-free diagnostics',
    async (kind) => {
      const { faux, execute, transport, prepare } = setup();
      faux.setResponses([submitted()]);
      expect((await execute(task(), reporter())).status).toBe('completed');
      const storage = await ApiDurableStorage.open(
        transport,
        BACKGROUND_CONTEXT,
      );
      const writes: StorageWrite[] = [];
      for (let n = 0; n < 25; n++) {
        writes.push(
          kind === 'tasks'
            ? {
                type: 'task',
                value: {
                  id: await storage.mintId<TaskId<null>>(),
                  conversationId: 1 as ConversationId,
                  kind: 'test.unfinished',
                  version: 1,
                  input: { secret: 'private-task-input' },
                  background: false,
                  abortRequested: false,
                  state: {
                    status: 'pending',
                    checkpoint: { secret: 'private-checkpoint' },
                  },
                },
              }
            : {
                type: 'submission',
                value: {
                  id: await storage.mintId<SubmissionId>(),
                  conversationId: 1 as ConversationId,
                  requestId: 'private-request-key-' + n,
                  type: 'input',
                  status: 'queued',
                },
              },
        );
      }
      await storage.commit(writes, BACKGROUND_CONTEXT);
      await storage.close(BACKGROUND_CONTEXT);
      const events = reporter();
      await expect(
        execute(
          task('aaaaaaaa-0000-4000-8000-000000000002', {
            brief: 'Continue',
            continueFrom: {
              taskId: 'aaaaaaaa-0000-4000-8000-000000000001',
              attemptN: 1,
            },
          }),
          events,
        ),
      ).rejects.toThrow('Parent Durable attempt has unfinished work');
      const diagnostic = recorded(events).find(
        (event) => event.payload.event === 'unfinished_parent_work',
      );
      expect(diagnostic).toMatchObject({
        kind: 'error',
        payload: {
          phase: 'durable_continuation',
          event: 'unfinished_parent_work',
          taskCount: kind === 'tasks' ? 25 : 0,
          submissionCount: kind === 'submissions' ? 25 : 0,
        },
      });
      expect(diagnostic?.payload[kind]).toHaveLength(20);
      expect(diagnostic?.payload[kind]).toEqual(
        expect.arrayContaining([
          expect.objectContaining(
            kind === 'tasks'
              ? {
                  conversationId: 1,
                  kind: 'test.unfinished',
                  ownerTaskId: null,
                  status: 'pending',
                  schedulerState: 'blocked',
                  reason: 'missing_task',
                }
              : { conversationId: 1, type: 'input', status: 'queued' },
          ),
        ]),
      );
      expect(JSON.stringify(recorded(events))).not.toContain('private-');
      expect(faux.state.callCount).toBe(1);
      expect(prepare).toHaveBeenCalledOnce();
    },
  );
  it('bounds missing-output reminders and persists failure', async () => {
    const { faux, execute } = setup();
    faux.setResponses(
      Array.from({ length: 4 }, () => fauxAssistantMessage('Finished')),
    );
    const result = await execute(task(), reporter());
    expect(result.error?.code).toBe('submit_output_missing');
    expect(faux.state.callCount).toBe(4);
    expect(await execute(task(), reporter())).toEqual(result);
  });
});

it('resumes after interrupted unsafe tool intent without executing the tool twice', async () => {
  const remote = remoteLog();
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const models = createModels();
  models.setProvider(faux.provider);
  let controller = new AbortController();
  const interruption = new TaskExecutionInterrupted('Durable writer lost', {
    cause: new Error('renew request timed out'),
  });
  let executions = 0;
  const execute = createDurableTaskExecutor({
    models,
    model: { provider: faux.provider.id, modelId: faux.models[0].id },
    open: async () => ({
      storage: await ApiDurableStorage.open(
        remote.transport,
        BACKGROUND_CONTEXT,
      ),
      signal: controller.signal,
      check: () => controller.signal.throwIfAborted(),
      prepare: async () => ({
        authorizeTool: async () => undefined,
        close: async () => {},
        tools: [
          {
            name: 'side_effect',
            description: 'An unsafe side effect',
            parameters: { type: 'object', properties: {} },
            replay: 'unsafe' as const,
            async execute() {
              executions++;
              controller.abort(interruption);
              throw new Error('interrupted');
            },
          },
        ],
      }),
    }),
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('side_effect', {}), {
      stopReason: 'toolUse',
    }),
    submitted(),
  ]);
  const interrupted = await execute(task(), reporter()).catch(
    (error: unknown) => error,
  );
  expect(interrupted).toBeInstanceOf(TaskExecutionInterrupted);
  expect((interrupted as Error).cause).toBe(interruption);
  expect(((interrupted as Error).cause as Error).cause).toEqual(
    new Error('renew request timed out'),
  );
  controller = new AbortController();
  const result = await execute(task(), reporter());
  expect(result.status).toBe('completed');
  expect(executions).toBe(1);
  expect(faux.state.callCount).toBe(2);
});

it('persists child output with its parent and reconciles without spawning again', async () => {
  const s = setup(true);
  let childTranscript = '';
  let parentTranscript = '';
  s.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('subagent', {
        task: 'Inspect the change',
        output_schema: 'verdict',
      }),
      { stopReason: 'toolUse' },
    ),
    (context) => {
      childTranscript = JSON.stringify(context);
      return fauxAssistantMessage(
        fauxToolCall('submit_subagent_output', { verdict: 'approved' }),
        { stopReason: 'toolUse' },
      );
    },
    (context) => {
      parentTranscript = JSON.stringify(context);
      return submitted();
    },
  ]);
  const result = await s.execute(task(), reporter());
  expect(result.status).toBe('completed');
  expect(childTranscript).toContain('Inspect the change');
  expect(childTranscript).not.toContain('submit_freeform_output');
  expect(childTranscript).not.toContain('Delegate a self-contained task');
  expect(parentTranscript).toContain('approved');
  expect(await s.execute(task(), reporter())).toEqual(result);
  expect(s.faux.state.callCount).toBe(3);
});

it('installs native extension tools and checks their calls against the current policy', async () => {
  const remote = remoteLog();
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const models = createModels();
  models.setProvider(faux.provider);
  const allowed = vi.fn(async () => ({
    output: [{ type: 'text' as const, text: 'native result' }],
  }));
  const blocked = vi.fn(allowed);
  const authorizeTool = vi.fn(async (name: string) =>
    name === 'blocked_native' ? 'policy denied' : undefined,
  );
  const execute = createDurableTaskExecutor({
    models,
    model: { provider: faux.provider.id, modelId: faux.models[0].id },
    open: async (_claimed, signal) => ({
      storage: await ApiDurableStorage.open(
        remote.transport,
        BACKGROUND_CONTEXT,
      ),
      signal,
      check: () => signal.throwIfAborted(),
      prepare: async () => ({
        authorizeTool,
        close: async () => {},
        extensions: [
          {
            name: 'team-native',
            tools: ['allowed_native', 'blocked_native'].map((name) => ({
              name,
              description: name,
              parameters: { type: 'object' as const, properties: {} },
              replay: 'safe' as const,
              execute: name === 'allowed_native' ? allowed : blocked,
            })),
          },
        ],
      }),
    }),
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('allowed_native', {}), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage(fauxToolCall('blocked_native', {}), {
      stopReason: 'toolUse',
    }),
    submitted(),
  ]);
  const events = reporter();
  expect((await execute(task(), events)).status).toBe('completed');
  expect(allowed).toHaveBeenCalledOnce();
  expect(blocked).not.toHaveBeenCalled();
  expect(authorizeTool).toHaveBeenCalledWith(
    'allowed_native',
    {},
    expect.anything(),
  );
  expect(
    recorded(events).filter(({ kind }) => kind.startsWith('tool_')),
  ).toEqual([
    { kind: 'tool_call_start', payload: { tool_name: 'allowed_native' } },
    {
      kind: 'tool_call_end',
      payload: {
        tool_name: 'allowed_native',
        is_error: false,
      },
    },
    { kind: 'tool_call_start', payload: { tool_name: 'blocked_native' } },
    {
      kind: 'tool_call_end',
      payload: {
        tool_name: 'blocked_native',
        is_error: true,
      },
    },
    {
      kind: 'tool_call_start',
      payload: { tool_name: 'submit_freeform_output' },
    },
    {
      kind: 'tool_call_end',
      payload: {
        tool_name: 'submit_freeform_output',
        is_error: false,
      },
    },
  ]);
});

describe('live task messages', () => {
  it('records turn boundaries without duplicating conversation content', async () => {
    const { faux, execute } = setup();
    faux.setResponses([fauxAssistantMessage('Looking around'), submitted()]);
    const events = reporter();
    expect((await execute(task(), events)).status).toBe('completed');
    expect(recorded(events).filter(({ kind }) => kind === 'turn_end')).toEqual([
      { kind: 'turn_end', payload: { stop_reason: 'stop' } },
      { kind: 'turn_end', payload: { stop_reason: 'toolUse' } },
    ]);
  });

  it('records why a finished attempt failed', async () => {
    const { faux, execute } = setup(false, 1);
    faux.setResponses([bashCall('pwd')]);
    const events = reporter();
    const result = await execute(task(), events);
    expect(result.error?.code).toBe('max_turns_exceeded');
    expect(recorded(events).at(-1)).toEqual({
      kind: 'error',
      payload: {
        phase: 'task_result',
        code: 'max_turns_exceeded',
        message: 'Durable task exceeded maxTurns without valid output',
      },
    });
  });

  it('keeps executing when the reporter cannot record', async () => {
    const { faux, execute } = setup();
    faux.setResponses([submitted()]);
    const events = reporter();
    events.record.mockRejectedValue(new Error('buffer closed'));
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      expect((await execute(task(), events)).status).toBe('completed');
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining('kind="tool_call_start": buffer closed'),
      );
    } finally {
      stderr.mockRestore();
    }
  });
});

describe('turn limits and cleanup', () => {
  function executor(
    prepared: Record<string, unknown>,
    extra: { subagentContracts?: boolean } = {},
  ) {
    const remote = remoteLog();
    const faux = fauxProvider({ tokensPerSecond: 0 });
    const models = createModels();
    models.setProvider(faux.provider);
    const execute = createDurableTaskExecutor({
      models,
      model: { provider: faux.provider.id, modelId: faux.models[0].id },
      ...(extra.subagentContracts === false
        ? {}
        : {
            subagentContracts: createSubagentContractRegistry([
              {
                name: 'verdict',
                description: 'Return a verdict',
                parametersSchema: Type.Object({ verdict: Type.String() }),
              },
            ]),
          }),
      open: async (_claimed, signal) => ({
        storage: await ApiDurableStorage.open(
          remote.transport,
          BACKGROUND_CONTEXT,
        ),
        signal,
        check: () => signal.throwIfAborted(),
        prepare: async () => ({
          authorizeTool: async () => undefined,
          close: async () => {},
          ...prepared,
        }),
      }),
    });
    return { faux, execute };
  }

  it('treats a zero turn limit as unlimited, like the legacy executor', async () => {
    const { faux, execute } = setup(false, 0);
    faux.setResponses(
      Array.from({ length: 4 }, () => fauxAssistantMessage('Finished')),
    );
    const result = await execute(task(), reporter());
    expect(result.error?.code).toBe('submit_output_missing');
    expect(faux.state.callCount).toBe(4);
  });

  it('interrupts a settled attempt whose environment cleanup fails and still closes the reporter', async () => {
    const { faux, execute } = executor({
      close: async () => {
        throw new Error('vm stuck');
      },
    });
    faux.setResponses([submitted()]);
    const events = reporter();
    const error = await execute(task(), events).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TaskExecutionInterrupted);
    expect((error as Error).message).toContain('environment cleanup');
    expect((error as Error).cause).toEqual(new Error('vm stuck'));
    expect(events.close).toHaveBeenCalledOnce();
  });

  it('keeps the original failure when cleanup also fails', async () => {
    const { execute } = executor(
      {
        subagentTools: [],
        close: async () => {
          throw new Error('vm stuck');
        },
      },
      { subagentContracts: false },
    );
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      const error = await execute(task(), reporter()).catch((e: unknown) => e);
      expect(error).not.toBeInstanceOf(TaskExecutionInterrupted);
      expect((error as Error).message).toBe(
        'Subagent contracts are required for delegation',
      );
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining('environment cleanup interrupted'),
      );
    } finally {
      stderr.mockRestore();
    }
  });
});

it('stops an in-flight tool on server timeout and drains the next task without refinalizing', async () => {
  vi.useFakeTimers();
  try {
    const claimed = task();
    claimed.claimAuthority = {
      leaseId: 'lease',
      executorFingerprint: 'executor',
    } as ClaimedTask['claimAuthority'];
    const remote = remoteLog();
    let timedOut = false;
    const startedAt = new Date().toISOString();
    const conflict = Object.assign(
      new Error('Attempt authority is no longer active'),
      { statusCode: 409 },
    );
    const stores = {
      open: vi.fn(async () => ({
        storeId: 'store',
        writerToken: 'writer',
        writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      })),
      renew: vi.fn(async () => {
        if (timedOut) throw conflict;
        return { writerExpiresAt: new Date(Date.now() + 30_000).toISOString() };
      }),
      read: vi.fn(async (_id: string, seq: number) =>
        remote.transport.read(seq, BACKGROUND_CONTEXT),
      ),
      mintId: vi.fn(async () => ({ id: await remote.transport.mintId() })),
      append: vi.fn(
        async (
          _id: string,
          commit: Parameters<typeof remote.transport.append>[0],
        ) => remote.transport.append(commit, BACKGROUND_CONTEXT),
      ),
      release: vi.fn(async () => {}),
    };
    const tasks = {
      heartbeat: vi.fn(async () => ({ cancelled: false })),
      appendMessages: vi.fn(async () => ({ count: 1 })),
      listAttempts: vi.fn(async () => [
        {
          attemptN: 1,
          status: 'timed_out',
          startedAt,
          completedAt: new Date().toISOString(),
          error: {
            code: 'running_total_exceeded',
            message: 'running_total_exceeded',
          },
          output: null,
          outputCid: null,
          usage: null,
        },
      ]),
    };
    const faux = fauxProvider({ tokensPerSecond: 0 });
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('wait', {}), { stopReason: 'toolUse' }),
      submitted(),
    ]);
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => {
      markToolStarted = resolve;
    });
    const toolStopped = vi.fn();
    const environmentClosed = vi.fn();
    const execute = createDurableTaskExecutor({
      models,
      model: { provider: faux.provider.id, modelId: faux.models[0].id },
      open: async (claim, signal) => {
        const connection = await acquireDurableTransport({
          stores: stores as unknown as RuntimeSessionsNamespace,
          claimed: claim,
          signal,
        });
        return {
          ...connection,
          storage: await ApiDurableStorage.open(
            connection.transport,
            BACKGROUND_CONTEXT,
          ),
          prepare: async () => ({
            authorizeTool: async () => undefined,
            close: environmentClosed,
            tools: [
              defineTool({
                name: 'wait',
                description: 'Wait for external work',
                parameters: Type.Object({}),
                async execute(_args, _api, context) {
                  markToolStarted();
                  await new Promise<void>((_resolve, reject) => {
                    const stop = () => {
                      toolStopped();
                      reject(
                        new Error('Tool aborted', {
                          cause: context.abortSignal?.reason,
                        }),
                      );
                    };
                    if (context.abortSignal?.aborted) stop();
                    else
                      context.abortSignal?.addEventListener('abort', stop, {
                        once: true,
                      });
                  });
                  return { output: [] };
                },
              }),
            ],
          }),
        };
      },
    });
    const queue = [claimed, task('bbbbbbbb-0000-4000-8000-000000000002')];
    const next = setup();
    next.faux.setResponses([submitted()]);
    const finished = vi.fn();
    const apiReporter = new ApiTaskReporter({
      tasks: tasks as unknown as TasksNamespace,
      teamId: 'team',
      heartbeatIntervalMs: 0,
    });
    const finalize = vi.spyOn(apiReporter, 'finalize');
    const runtime = new AgentRuntime({
      source: {
        claim: async () => queue.shift() ?? null,
        close: async () => {},
      },
      makeReporter: (claim) =>
        claim.task.id === claimed.task.id ? apiReporter : reporter(),
      executeTask: (claim, events) =>
        claim.task.id === claimed.task.id
          ? execute(claim, events)
          : next.execute(claim, events),
      onTaskFinished: finished,
    });
    const pending = runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await toolStarted;
    // The server's running budget expires while a tool is still executing.
    timedOut = true;
    await vi.advanceTimersByTimeAsync(5_000);
    const outputs = await pending;
    expect(outputs.map((output) => output.status)).toEqual([
      'failed',
      'completed',
    ]);
    expect(outputs[0].error?.code).toBe('running_total_exceeded');
    expect(toolStopped).toHaveBeenCalledTimes(1);
    expect(environmentClosed).toHaveBeenCalledTimes(1);
    expect(faux.state.callCount).toBe(1);
    expect(finalize).not.toHaveBeenCalled();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(finished.mock.calls[0][0].taskId).toBe(outputs[1].taskId);
    expect(stores.release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stores.renew).toHaveBeenCalledTimes(1);
    expect(tasks.listAttempts).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it.each([false, true])(
  'runs native codemode with nested permission %s',
  async (allowLookup) => {
    const lookup = vi.fn(async () => ({
      output: [{ type: 'text' as const, text: 'classified' }],
    }));
    const s = setup(false, 4, undefined, {
      tools: [
        defineTool({
          name: 'lookup',
          description: 'Lookup',
          parameters: Type.Object({}),
          execute: lookup,
        }),
      ],
      extensions: [piCodemode().extension],
    });
    const prepare = s.prepare.getMockImplementation()!;
    const authorize = vi.fn(async (name: string) =>
      name === 'lookup' && !allowLookup ? 'blocked' : undefined,
    );
    s.prepare.mockImplementation(async () => ({
      ...(await prepare()),
      authorizeTool: authorize,
    }));
    let transcript = '';
    s.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('codemode', {
          code: 'console.log(await tools.lookup({}));',
        }),
        { stopReason: 'toolUse' },
      ),
      (context) => {
        transcript = JSON.stringify(context);
        return submitted();
      },
    ]);
    const result = await s.execute(task(), reporter());
    expect(result.status).toBe('completed');
    expect(authorize).toHaveBeenCalledWith('lookup', {}, expect.anything());
    expect(lookup).toHaveBeenCalledTimes(allowLookup ? 1 : 0);
    expect(transcript).toContain(allowLookup ? 'classified' : 'blocked');
  },
);

it('executes models.classify inside native codemode using the registered provider', async () => {
  const s = setup(false, 4, undefined, {
    extensions: [piCodemode().extension],
  });
  const classifier = {
    ...s.faux.models[0],
    type: 'classifier' as const,
    api: 'typesafe-system-one' as const,
    provider: 'classifier-fixture',
    id: 'decision',
  };
  const classify = vi.fn(async () => ({
    provider: classifier.provider,
    model: classifier.id,
    api: classifier.api,
    timestamp: 0,
    stopReason: 'stop' as const,
    answers: { actionable: { type: 'bool' as const, probability: 0.8 } },
  }));
  s.models.setProvider(
    createProvider({
      id: classifier.provider,
      auth: s.faux.provider.auth,
      models: [classifier],
      classifiers: { 'typesafe-system-one': { classify } },
    }),
  );
  let transcript = '';
  s.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('codemode', {
        code: `
      const model = await models.getModelOfType('classifier', 'classifier-fixture', 'decision');
      const result = await models.classify(model, { state: { issue: 'reproducible' }, questions: {
        actionable: { type: 'bool', instructions: 'Is it actionable?', criteria: { true: 'reproducible', false: 'unclear' } }
      } });
      console.log(result.answers.actionable.probability);
    `,
      }),
      { stopReason: 'toolUse' },
    ),
    (context) => {
      transcript = JSON.stringify(context);
      return submitted();
    },
  ]);
  expect((await s.execute(task(), reporter())).status).toBe('completed');
  expect(classify).toHaveBeenCalledOnce();
  expect(classify.mock.calls[0]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        provider: 'classifier-fixture',
        id: 'decision',
        type: 'classifier',
      }),
      expect.objectContaining({ state: { issue: 'reproducible' } }),
    ]),
  );
  expect(transcript).toContain('0.8');
});

it('connects native Durable and model spans to the task trace without recording conversation content', async () => {
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer('durable-integration');
  const host = tracer.startSpan('moltnet.task.execute');
  try {
    const telemetry = createPiTelemetry({
      tracer,
      parentContext: trace.setSpan(ROOT_CONTEXT, host),
    });
    const { faux, execute } = setup(false, undefined, undefined, { telemetry });
    const summary = 'Unique private submission content';
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('submit_freeform_output', { summary }),
        { stopReason: 'toolUse' },
      ),
    ]);
    expect((await execute(task(), reporter())).status).toBe('completed');
    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        'pi.durable.submit',
        'pi.durable.phase',
        'pi.ai.request',
      ]),
    );
    const request = spans.find((span) => span.name === 'pi.ai.request')!;
    const submit = spans.find((span) => span.name === 'pi.durable.submit')!;
    const phase = spans.find((span) => span.name === 'pi.durable.phase')!;
    expect(phase.parentSpanContext?.spanId).toBe(submit.spanContext().spanId);
    expect(
      spans.find(
        (span) =>
          span.spanContext().spanId === request.parentSpanContext?.spanId,
      )?.name,
    ).toBe('pi.durable.phase');
    expect(
      spans.every(
        (span) => span.spanContext().traceId === host.spanContext().traceId,
      ),
    ).toBe(true);
    expect(
      JSON.stringify(
        spans.map((span) => ({
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        })),
      ),
    ).not.toContain(summary);
  } finally {
    propagation.disable();
    host.end();
    await provider.shutdown();
  }
});
