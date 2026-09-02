import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createPiRetryTriage, resolveRuntimeProfileModel, runPiRetryTriage } =
  vi.hoisted(() => ({
    createPiRetryTriage: vi.fn(),
    resolveRuntimeProfileModel: vi.fn(),
    runPiRetryTriage: vi.fn(),
  }));

vi.mock('@themoltnet/pi-runtime', () => ({
  createPiRetryTriage,
  resolveRuntimeProfileModel,
}));

import { createRuntimeProfileRetryTriage } from './runtime-profile-retry-triage.js';

describe('createRuntimeProfileRetryTriage', () => {
  beforeEach(() => {
    createPiRetryTriage.mockReset();
    resolveRuntimeProfileModel.mockReset();
    runPiRetryTriage.mockReset();
  });

  it('shares the resolved model runtime with the retry-triage session', async () => {
    const modelHandle = { id: 'planner-fast' };
    const modelRuntime = { kind: 'runtime' };
    const result = {
      decision: 'do_not_retry',
      confidence: 'high',
      reason: 'deterministic failure',
    };
    resolveRuntimeProfileModel.mockResolvedValue({
      modelHandle,
      modelRuntime,
    });
    runPiRetryTriage.mockResolvedValue(result);
    createPiRetryTriage.mockReturnValue(runPiRetryTriage);
    const input = { task: { id: 'task-1' } };

    const triage = createRuntimeProfileRetryTriage({
      runtimeProfile: {
        provider: 'custom-cloud',
        model: 'planner-fast',
        thinkingLevel: 'high',
      },
      piAgentDir: '/agent',
      timeoutMs: 12_000,
      cwd: '/workspace',
    });
    await expect(triage(input as never)).resolves.toEqual(result);

    expect(resolveRuntimeProfileModel).toHaveBeenCalledWith(
      '/agent',
      'custom-cloud',
      'planner-fast',
    );
    expect(createPiRetryTriage).toHaveBeenCalledWith({
      model: modelHandle,
      modelRuntime,
      thinkingLevel: 'high',
      piAgentDir: '/agent',
      timeoutMs: 12_000,
      cwd: '/workspace',
    });
    expect(runPiRetryTriage).toHaveBeenCalledWith(input);
  });
});
