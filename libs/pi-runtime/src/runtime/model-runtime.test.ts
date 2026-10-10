import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

it('finds Pi builtin Jev without codemode or a custom catalog', async () => {
  const piDir = mkdtempSync(join(tmpdir(), 'builtin-classifier-'));
  dirs.push(piDir);
  const models = await createRuntimeModels(piDir);
  expect(
    models.getModelOfType('classifier', 'typesafe', 'jev-latest'),
  ).toMatchObject({ type: 'classifier', api: 'typesafe-system-one' });
  expect(models.getModel('typesafe', 'jev-latest')).toBeUndefined();
});

it('preserves native catalogs, model types and provider overrides across refresh', async () => {
  const piDir = mkdtempSync(join(tmpdir(), 'native-catalog-'));
  dirs.push(piDir);
  writePiConfig({
    piDir,
    providers: {
      typesafe: {
        api: 'openai-completions',
        baseUrl: 'https://proxy.example/v1',
        models: [
          { id: 'shared', type: 'chat', supportsStrictMode: true },
          { id: 'decisions', type: 'classifier' },
        ],
      },
    },
  });
  // The native JSON loader and the classifier adapter must read the same JSONC.
  const path = join(piDir, 'models.json');
  const document = JSON.parse(readFileSync(path, 'utf8'));
  document.providers.typesafe.modelOverrides = {
    shared: { contextWindow: 12345 },
  };
  writeFileSync(
    path,
    '\uFEFF// Shared provider configuration\n' + JSON.stringify(document),
  );
  const models = await createRuntimeModels(piDir);
  await models.refresh({ allowNetwork: false });
  expect(models.getModel('typesafe', 'shared')).toMatchObject({
    compat: { supportsStrictMode: true },
    contextWindow: 12345,
  });
  expect(
    models.getModelOfType('classifier', 'typesafe', 'decisions'),
  ).toMatchObject({ type: 'classifier', api: 'typesafe-system-one' });
  expect(
    models.getModelOfType('classifier', 'typesafe', 'jev-latest'),
  ).toMatchObject({ baseUrl: 'https://proxy.example/v1' });
  expect(models.getModel('typesafe', 'decisions')).toBeUndefined();
  expect(models.getError()).toBeUndefined();
});

it.each([
  [{ id: 'bad', type: 'classifier', api: 'openai-completions' }],
  [{ id: 'bad', type: 'classifier', reasoning: true }],
  [
    { id: 'same', type: 'classifier' },
    { id: 'same', type: 'classifier' },
  ],
])(
  'rejects invalid typed declarations before execution: %j',
  async (...models) => {
    const piDir = mkdtempSync(join(tmpdir(), 'invalid-models-'));
    dirs.push(piDir);
    writeFileSync(
      join(piDir, 'models.json'),
      JSON.stringify({
        providers: {
          team: {
            api: 'openai-completions',
            baseUrl: 'https://example.test',
            models,
          },
        },
      }),
    );
    await expect(createRuntimeModels(piDir)).rejects.toThrow(
      /Invalid classifier|Duplicate model/,
    );
  },
);
