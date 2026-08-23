import { assertProbeRun } from './evidence.js';
import type {
  ControlEvidence,
  ResearchSandboxAdapter,
  SandboxProbeRun,
  ScenarioCatalog,
} from './types.js';

export interface RunAdapterProbeOptions {
  adapter: ResearchSandboxAdapter;
  catalog: ScenarioCatalog;
  runId: string;
  sourceRevision: string;
  probeRoot: string;
  now?: () => string;
}

export async function runAdapterProbe(
  options: RunAdapterProbeOptions,
): Promise<SandboxProbeRun> {
  const now = options.now ?? (() => new Date().toISOString());
  const backend = await options.adapter.inspect();
  const controls: ControlEvidence[] = [];
  let cleanupComplete = false;
  try {
    for (const scenario of options.catalog.scenarios) {
      try {
        controls.push(
          await options.adapter.runScenario(scenario, {
            runId: options.runId,
            recordedAt: now,
            probeRoot: options.probeRoot,
          }),
        );
      } catch (error) {
        controls.push({
          scenarioId: scenario.id,
          requestedIntent: {
            scenarioId: scenario.id,
            domain: scenario.domain,
            control: scenario.control,
            required: scenario.required,
          },
          resolvedAdapterConfig: null,
          backend: { id: backend.id, version: backend.version },
          enforcementLocus: ['research-harness'],
          state: 'failed',
          basis: 'verified',
          oracle: null,
          reasonCode: 'adapter_scenario_error',
          recordedAt: now(),
          persistentMutations: [],
          notes: [error instanceof Error ? error.message : String(error)],
        });
      }
    }
  } finally {
    const cleanup = await options.adapter.close();
    cleanupComplete = cleanup.every(
      (mutation) => mutation.cleanup === 'cleaned',
    );
  }
  const run: SandboxProbeRun = {
    schemaVersion: 1,
    catalogVersion: options.catalog.catalogVersion,
    runId: options.runId,
    sourceRevision: options.sourceRevision,
    recordedAt: now(),
    backend,
    controls,
    hostCapabilities: await options.adapter.hostCapabilities(),
    cleanupComplete,
  };
  assertProbeRun(run);
  return run;
}
