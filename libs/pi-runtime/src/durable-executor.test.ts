import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  Type,
} from '@earendil-works/pi-ai';
import {
  defineExtension,
  defineTool,
  type Extension,
} from '@earendil-works/pi-durable';
import {
  type ClaimedTask,
  createSubagentContractRegistry,
  type TaskReporter,
} from '@themoltnet/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import { remoteLog } from '../__tests__/durable-log.js';
import { createDurableTaskExecutor } from './durable-executor.js';
import { ApiDurableStorage } from './durable-storage.js';

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
function reporter(): TaskReporter {
  return {
    open: vi.fn(),
    record: vi.fn(),
    finalize: vi.fn(),
    close: vi.fn(),
    cancelReason: null,
    cancelSignal: new AbortController().signal,
  };
}
function setup(
  subagents = false,
  maxTurns?: number,
  subagentExtensions?: readonly Extension[],
) {
  const remote = remoteLog();
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const models = createModels();
  models.setProvider(faux.provider);
  const prepare = vi.fn(async () => ({
    authorizeTool: vi.fn(async (name: string) =>
      name === 'subagent' ? undefined : 'blocked',
    ),
    ...(subagents ? { subagentTools: [] } : {}),
    subagentExtensions,
    close: vi.fn(),
  }));
  const execute = createDurableTaskExecutor({
    models,
    maxTurns,
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
  return { ...remote, faux, execute, prepare };
}
const submitted = () =>
  fauxAssistantMessage(
    fauxToolCall('submit_freeform_output', { summary: 'Done' }),
    { stopReason: 'toolUse' },
  );

describe('Durable task integration', () => {
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

  it('reports the durable generation limit when no output was submitted', async () => {
    const { faux, execute } = setup(false, 2);
    faux.setResponses([
      fauxAssistantMessage('Finished'),
      fauxAssistantMessage('Still finished'),
    ]);
    const result = await execute(task(), reporter());
    expect(result.error?.code).toBe('max_turns_exceeded');
    expect(faux.state.callCount).toBe(2);
    expect(await execute(task(), reporter())).toEqual(result);
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
      content: [{ type: 'text' as const, text: 'unreachable' }],
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
  await expect(execute(task(), reporter())).rejects.toThrow('interrupted');
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
    content: [{ type: 'text' as const, text: 'native result' }],
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
  expect((await execute(task(), reporter())).status).toBe('completed');
  expect(allowed).toHaveBeenCalledOnce();
  expect(blocked).not.toHaveBeenCalled();
  expect(authorizeTool).toHaveBeenCalledWith(
    'allowed_native',
    {},
    expect.anything(),
  );
});
