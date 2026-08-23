import { describe, expect, it } from 'vitest';

import { runAdapterProbe } from './runner.js';
import type {
  ControlEvidence,
  ResearchSandboxAdapter,
  SandboxScenario,
} from './types.js';

class FixtureAdapter implements ResearchSandboxAdapter {
  closed = false;

  inspect() {
    return Promise.resolve({
      id: 'fixture',
      version: '1.0.0',
      os: 'test',
      architecture: 'test',
      topology: ['guest', 'host'],
    });
  }

  runScenario(scenario: SandboxScenario): Promise<ControlEvidence> {
    if (scenario.id === 'network.failure') throw new Error('fixture failure');
    return Promise.resolve({
      scenarioId: scenario.id,
      requestedIntent: {
        scenarioId: scenario.id,
        domain: scenario.domain,
        control: scenario.control,
        required: scenario.required,
      },
      resolvedAdapterConfig: null,
      backend: { id: 'fixture', version: '1.0.0' },
      enforcementLocus: ['fixture'],
      state: 'unsupported',
      basis: 'declared',
      oracle: null,
      reasonCode: 'fixture_unsupported',
      recordedAt: '2026-08-23T00:00:00.000Z',
      persistentMutations: [],
    });
  }

  hostCapabilities() {
    return Promise.resolve([]);
  }

  close() {
    this.closed = true;
    return Promise.resolve([
      { kind: 'fixture', resource: 'fixture', cleanup: 'cleaned' as const },
    ]);
  }
}

describe('sandbox policy adapter runner', () => {
  it('runs serial scenarios, retains failures, and always closes the adapter', async () => {
    const adapter = new FixtureAdapter();
    const run = await runAdapterProbe({
      adapter,
      catalog: {
        schemaVersion: 1,
        catalogVersion: 'test',
        notice: 'test',
        scenarios: [
          {
            id: 'network.first',
            domain: 'network',
            control: 'first',
            purpose: 'first',
            required: true,
            oracle: 'first',
          },
          {
            id: 'network.failure',
            domain: 'network',
            control: 'failure',
            purpose: 'failure',
            required: true,
            oracle: 'failure',
          },
        ],
      },
      runId: 'run',
      sourceRevision: 'revision',
      probeRoot: '/tmp/probe',
      now: () => '2026-08-23T00:00:00.000Z',
    });

    expect(adapter.closed).toBe(true);
    expect(run.cleanupComplete).toBe(true);
    expect(run.controls).toHaveLength(2);
    expect(run.controls[1]).toMatchObject({
      scenarioId: 'network.failure',
      state: 'failed',
      reasonCode: 'adapter_scenario_error',
    });
  });
});
