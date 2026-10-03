import type {
  ClassifierApi,
  ClassifierModel,
  ClassifierResult,
} from '@earendil-works/pi-ai';
import type { ClaimedTask } from '@themoltnet/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import {
  createClassificationTaskExecutor,
  piCodemode,
  registerOllamaDecisionModels,
} from './classification.js';

const model = {
  provider: 'typesafe',
  id: 'jev',
  type: 'classifier',
} as ClassifierModel<ClassifierApi>;
const claimed = {
  task: {
    id: 'task',
    taskType: 'classify',
    input: {
      version: 1,
      state: { issue: 'Crash' },
      questions: {
        actionable: {
          type: 'bool',
          instructions: 'Actionable?',
          criteria: { true: 'Reproducible', false: 'Unclear' },
        },
      },
    },
  },
  attemptN: 1,
  traceHeaders: {},
} as unknown as ClaimedTask;
const answer: ClassifierResult = {
  provider: 'typesafe',
  model: 'jev',
  api: 'typesafe-system-one',
  stopReason: 'stop',
  timestamp: 0,
  answers: { actionable: { type: 'bool', probability: 0.9 } },
};
function reporter(signal = new AbortController().signal) {
  return {
    open: vi.fn(),
    record: vi.fn(),
    close: vi.fn(),
    finalize: vi.fn(),
    cancelSignal: signal,
    cancelReason: null,
  };
}
describe('direct classification task', () => {
  it('preserves provider answers and unknown usage, and produces the normal output CID', async () => {
    const classify = vi.fn(async () => answer);
    const sink = reporter();
    const output = await createClassificationTaskExecutor({
      models: { classify },
      model,
    })(claimed, sink);
    expect(output.status).toBe('completed');
    expect(output.output).toEqual({
      version: 1,
      provider: 'typesafe',
      model: 'jev',
      answers: answer.answers,
    });
    expect(output.outputCid).toMatch(/^b/);
    expect(classify).toHaveBeenCalledWith(
      model,
      {
        state: claimed.task.input.state,
        questions: claimed.task.input.questions,
      },
      { signal: sink.cancelSignal },
    );
    expect(sink.close).toHaveBeenCalledOnce();
  });
  it.each(['error', 'aborted'] as const)(
    'maps %s without inventing an answer',
    async (stopReason) => {
      const output = await createClassificationTaskExecutor({
        models: { classify: vi.fn(async () => ({ ...answer, stopReason })) },
        model,
      })(claimed, reporter());
      expect(output.status).toBe(
        stopReason === 'aborted' ? 'cancelled' : 'failed',
      );
      expect(output.output).toBeNull();
      expect(output.outputCid).toBeNull();
    },
  );
  it('rejects incomplete responses and prevents requests after cancellation', async () => {
    const classify = vi.fn(async () => ({ ...answer, answers: {} }));
    const execute = createClassificationTaskExecutor({
      models: { classify },
      model,
    });
    expect((await execute(claimed, reporter())).status).toBe('failed');
    classify.mockClear();
    expect((await execute(claimed, reporter(AbortSignal.abort()))).status).toBe(
      'cancelled',
    );
    expect(classify).not.toHaveBeenCalled();
  });
  it('registers Ollama decision models separately from chat, and declares codemode explicitly', () => {
    const registerProvider = vi.fn();
    registerOllamaDecisionModels(
      { registerProvider },
      { models: [{ id: 'jev-local', contextWindow: 8192 }] },
    );
    expect(registerProvider).toHaveBeenCalledWith(
      'ollama-decision',
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: [
          expect.objectContaining({
            type: 'classifier',
            api: 'typesafe-system-one',
          }),
        ],
      }),
    );
    expect(piCodemode().declaredTools).toEqual(['codemode']);
  });
});
