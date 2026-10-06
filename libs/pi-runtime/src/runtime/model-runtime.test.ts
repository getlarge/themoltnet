import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classify } from '@earendil-works/pi-ai/api/typesafe-system-one';
import type { ClaimedTask } from '@themoltnet/agent-runtime';
import { afterEach, expect, it, vi } from 'vitest';

import { createGondolinDurableTaskExecutor } from '../durable-gondolin.js';
import { writePiConfig } from '../pi-config.js';
import { createPiTaskExecutor } from './execute-pi-task.js';
import { createRuntimeModels } from './model-runtime.js';

vi.mock('@earendil-works/pi-ai/api/typesafe-system-one', () => ({
  classify: vi.fn(),
}));
const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

it.each(['environment', 'auth', 'classifier-only'])(
  'uses configured %s credentials for a classifier and preserves the same provider chat catalog',
  async (source) => {
    const piDir = mkdtempSync(join(tmpdir(), 'classifier-runtime-'));
    dirs.push(piDir);
    vi.stubEnv('TEST_CLASSIFIER_API_KEY', 'configured-test-key');
    if (source === 'auth')
      writeFileSync(
        join(piDir, 'auth.json'),
        JSON.stringify({ team: { type: 'api_key', key: 'stored-test-key' } }),
      );
    writePiConfig({
      piDir,
      providers: {
        team: {
          api:
            source === 'classifier-only'
              ? 'typesafe-system-one'
              : 'openai-completions',
          baseUrl: 'https://classifier.example.test/v1',
          ...(source !== 'auth'
            ? { apiKeyEnvRef: '$TEST_CLASSIFIER_API_KEY' }
            : {}),
          models: [
            ...(source === 'classifier-only' ? [] : [{ id: 'chat' }]),
            {
              id: 'decisions',
              type: 'classifier',
              api: 'typesafe-system-one',
              contextWindow: 4096,
            },
          ],
        },
      },
    });
    vi.mocked(classify).mockResolvedValue({
      provider: 'team',
      model: 'decisions',
      api: 'typesafe-system-one',
      timestamp: 0,
      stopReason: 'stop',
      answers: {},
    });
    const models = await createRuntimeModels(piDir);
    expect(Boolean(models.getModel('team', 'chat'))).toBe(
      source !== 'classifier-only',
    );
    expect(models.getModel('team', 'decisions')).toBeUndefined();
    const model = models.getModelOfType('classifier', 'team', 'decisions');
    expect(model?.baseUrl).toBe('https://classifier.example.test/v1');
    if (!model) throw new Error('classifier missing');
    await models.classify(model, { state: {}, questions: {} });
    expect(classify).toHaveBeenCalledOnce();
    expect(vi.mocked(classify).mock.calls[0][2]?.apiKey).toBe(
      source !== 'auth' ? 'configured-test-key' : 'stored-test-key',
    );
  },
);

it.each([
  ['Pi', createPiTaskExecutor],
  ['Durable', createGondolinDurableTaskExecutor],
] as const)(
  'dispatches a standalone classifier through %s without a coding VM',
  async (_name, factory) => {
    const piDir = mkdtempSync(join(tmpdir(), 'classifier-task-'));
    dirs.push(piDir);
    vi.stubEnv('PI_CODING_AGENT_DIR', piDir);
    vi.stubEnv('TEST_CLASSIFIER_API_KEY', 'configured-test-key');
    writePiConfig({
      piDir,
      providers: {
        team: {
          api: 'typesafe-system-one',
          baseUrl: 'https://classifier.example.test/v1',
          apiKeyEnvRef: '$TEST_CLASSIFIER_API_KEY',
          models: [{ id: 'decisions', type: 'classifier' }],
        },
      },
    });
    vi.mocked(classify).mockResolvedValue({
      provider: 'team',
      model: 'decisions',
      api: 'typesafe-system-one',
      timestamp: 0,
      stopReason: 'stop',
      answers: { actionable: { type: 'bool', probability: 0.9 } },
    });
    const resumeVm = vi.fn();
    const execute = factory({
      classifier: { provider: 'team', model: 'decisions' },
      resumeVm,
    } as unknown as Parameters<typeof createGondolinDurableTaskExecutor>[0]);
    const reporter = {
      open: vi.fn(),
      record: vi.fn(),
      close: vi.fn(),
      finalize: vi.fn(),
      cancelSignal: new AbortController().signal,
      cancelReason: null,
    };
    const result = await execute(
      {
        task: {
          id: 'task',
          taskType: 'classify',
          input: {
            version: 1,
            state: { issue: 'Reproducible crash' },
            questions: {
              actionable: {
                type: 'bool',
                instructions: 'Is this actionable?',
                criteria: { true: 'Reproducible', false: 'Unclear' },
              },
            },
          },
        },
        attemptN: 1,
      } as unknown as ClaimedTask,
      reporter,
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe('completed');
    expect(result.outputCid).toMatch(/^b/);
    expect(resumeVm).not.toHaveBeenCalled();
    expect(reporter.close).toHaveBeenCalledOnce();
  },
);
