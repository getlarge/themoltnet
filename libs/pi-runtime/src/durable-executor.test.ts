import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import type { ClaimedTask, TaskReporter } from '@themoltnet/agent-runtime';
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
function setup() {
  const remote = remoteLog();
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const models = createModels();
  models.setProvider(faux.provider);
  const prepare = vi.fn(async () => ({
    authorizeTool: vi.fn(async () => 'blocked'),
    close: vi.fn(),
  }));
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
