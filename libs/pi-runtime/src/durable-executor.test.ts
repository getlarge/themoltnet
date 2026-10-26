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
  defineExtension,
  defineTool,
  type Extension,
  type ToolRegistration,
} from '@earendil-works/pi-durable';
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

import { remoteLog } from '../__tests__/durable-log.js';
import { createDurableTaskExecutor } from './durable-executor.js';
import { ApiDurableStorage } from './durable-storage.js';
import { acquireDurableTransport } from './durable-transport.js';
import { piCodemode } from './runtime-definition.js';

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
              controller.abort(new Error('simulated process interruption'));
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
  await expect(execute(task(), reporter())).rejects.toBeInstanceOf(
    TaskExecutionInterrupted,
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
