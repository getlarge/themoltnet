import { describe, expect, it } from 'vitest';

import { requestedIntent, runAdapterProbe } from './runner.js';
import type {
  ControlEvidence,
  ProbeContext,
  ResearchSandboxAdapter,
  SandboxScenario,
  ScenarioCatalog,
} from './types.js';

const catalog: ScenarioCatalog = {
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
};

function options(adapter: ResearchSandboxAdapter) {
  return {
    adapter,
    catalog,
    runId: 'run',
    sourceRevision: 'revision',
    probeRoot: '/tmp/probe',
    now: () => '2026-08-23T00:00:00.000Z',
    onProgress: () => undefined,
  };
}

class FixtureAdapter implements ResearchSandboxAdapter {
  closed = false;
  closeCalls = 0;
  failInspect = false;
  failWithSensitiveDiagnostic = false;
  failClose = false;
  leaveResidue = false;

  inspect() {
    if (this.failInspect) {
      throw new Error(
        this.failWithSensitiveDiagnostic
          ? 'diagnostic-secret'
          : '/Users/alice/inspect failed',
      );
    }
    return Promise.resolve({
      id: 'fixture',
      version: '1.0.0',
      os: 'test',
      architecture: 'test',
      topology: ['guest', 'host'],
    });
  }

  runScenario(
    scenario: SandboxScenario,
    context: ProbeContext,
  ): Promise<ControlEvidence> {
    if (scenario.id === 'network.failure') {
      throw new Error('/Users/alice/fixture failure');
    }
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
      unsupportedKind: 'backend-capability',
      basis: 'declared',
      oracle: null,
      reasonCode: 'fixture_unsupported',
      recordedAt: context.recordedAt(),
      persistentMutations: this.leaveResidue
        ? [{ kind: 'fixture', resource: 'fixture', cleanup: 'residue' }]
        : [],
    });
  }

  hostCapabilities() {
    if (this.closed) throw new Error('capabilities requested after close');
    return Promise.resolve([]);
  }

  sensitiveValues() {
    return ['diagnostic-secret'];
  }

  close() {
    this.closeCalls += 1;
    this.closed = true;
    if (this.failClose) throw new Error('/Users/alice/close failed');
    return Promise.resolve([
      { kind: 'fixture', resource: 'fixture', cleanup: 'cleaned' as const },
    ]);
  }
}

describe('sandbox policy adapter runner', () => {
  it('projects the canonical requested intent including parameters', () => {
    expect(
      requestedIntent({
        ...catalog.scenarios[0],
        parameters: { cpuCount: 2, tolerancePercent: 5 },
      }),
    ).toEqual({
      scenarioId: 'network.first',
      domain: 'network',
      control: 'first',
      required: true,
      parameters: { cpuCount: 2, tolerancePercent: 5 },
    });
  });

  it('retains scenario failures, captures capabilities, and always closes', async () => {
    const adapter = new FixtureAdapter();
    const run = await runAdapterProbe(options(adapter));

    expect(adapter.closed).toBe(true);
    expect(run.cleanupComplete).toBe(true);
    expect(run.cleanup).toHaveLength(1);
    expect(run.violations).toEqual([]);
    expect(run.controls).toHaveLength(2);
    expect(run.controls[1]).toMatchObject({
      scenarioId: 'network.failure',
      state: 'failed',
      basis: 'harness-observed',
      reasonCode: 'adapter_scenario_error',
      notes: ['<redacted sensitive diagnostic>'],
    });
    expect(run.sensitiveDiagnosticRedactions).toBe(0);
  });

  it('closes and returns evidence when inspection fails', async () => {
    const adapter = new FixtureAdapter();
    adapter.failInspect = true;

    const run = await runAdapterProbe(options(adapter));

    expect(adapter.closed).toBe(true);
    expect(run.controls).toHaveLength(catalog.scenarios.length);
    expect(run.controls[0]).toMatchObject({
      state: 'failed',
      reasonCode: 'adapter_inspect_error',
    });
    expect(run.violations).toContainEqual(
      expect.objectContaining({ code: 'adapter_inspect_error' }),
    );
  });

  it('counts sensitive values redacted from diagnostics', async () => {
    const adapter = new FixtureAdapter();
    adapter.failInspect = true;
    adapter.failWithSensitiveDiagnostic = true;

    const run = await runAdapterProbe(options(adapter));

    expect(run.sensitiveDiagnosticRedactions).toBe(1);
    expect(run.violations[0]?.message).toBe('<redacted sensitive diagnostic>');
  });

  it('preserves controls when close throws', async () => {
    const adapter = new FixtureAdapter();
    adapter.failClose = true;

    const run = await runAdapterProbe(options(adapter));

    expect(run.controls).toHaveLength(2);
    expect(run.cleanupComplete).toBe(false);
    expect(run.violations).toContainEqual({
      code: 'adapter_cleanup_error',
      message: '<redacted sensitive diagnostic>',
    });
  });

  it('marks explicit per-control residue as incomplete cleanup', async () => {
    const adapter = new FixtureAdapter();
    adapter.leaveResidue = true;

    const run = await runAdapterProbe(options(adapter));

    expect(run.cleanupComplete).toBe(false);
  });

  it('aborts and waits for scenario settlement before recording a timeout', async () => {
    const adapter = new FixtureAdapter();
    let aborted = false;
    let firstSettled = false;
    let secondObservedSettlement = false;
    const runScenario = adapter.runScenario.bind(adapter);
    adapter.runScenario = async (scenario, context) => {
      if (scenario.id !== 'network.first') {
        secondObservedSettlement = firstSettled;
        return runScenario(scenario, context);
      }
      await new Promise<void>((resolve) => {
        context.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        );
      });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
      firstSettled = true;
      throw context.signal.reason;
    };

    const run = await runAdapterProbe({
      ...options(adapter),
      scenarioTimeoutMs: 5,
    });

    expect(aborted).toBe(true);
    expect(secondObservedSettlement).toBe(true);
    expect(run.controls[0]).toMatchObject({
      state: 'failed',
      reasonCode: 'adapter_scenario_timeout',
    });
  });

  it('does not silently promote repeated-close evidence or close twice', async () => {
    const adapter = new FixtureAdapter();
    const repeatedClose: SandboxScenario = {
      id: 'lifecycle.repeated-close',
      domain: 'lifecycle',
      control: 'idempotent-close',
      purpose: 'test adapter close ownership',
      required: true,
      oracle: 'adapter evidence remains authoritative',
    };

    const run = await runAdapterProbe({
      ...options(adapter),
      catalog: { ...catalog, scenarios: [repeatedClose] },
    });

    expect(adapter.closeCalls).toBe(1);
    expect(run.controls[0]).toMatchObject({
      state: 'unsupported',
      basis: 'declared',
      reasonCode: 'fixture_unsupported',
    });
  });
});
