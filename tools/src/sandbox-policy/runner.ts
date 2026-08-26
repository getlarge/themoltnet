import { validateProbeRun } from './evidence.js';
import { sanitizeDiagnostic } from './sanitize.js';
import type {
  BackendInventory,
  ContainmentIntent,
  ControlEvidence,
  HostCapabilityEvidence,
  PersistentMutationEvidence,
  ResearchSandboxAdapter,
  SandboxProbeRun,
  SandboxScenario,
  ScenarioCatalog,
} from './types.js';

const DEFAULT_SCENARIO_TIMEOUT_MS = 60_000;

export interface ProbeProgressEvent {
  scenarioId: string;
  domain: string;
  index: number;
  total: number;
  phase: 'started' | 'completed' | 'failed' | 'timed-out';
}

export interface RunAdapterProbeOptions {
  adapter: ResearchSandboxAdapter;
  catalog: ScenarioCatalog;
  runId: string;
  sourceRevision: string;
  probeRoot: string;
  now?: () => string;
  scenarioTimeoutMs?: number;
  onProgress?: (event: ProbeProgressEvent) => void;
}

class ScenarioTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`adapter scenario timed out after ${timeoutMs}ms`);
    this.name = 'ScenarioTimeoutError';
  }
}

function unavailableBackend(): BackendInventory {
  return {
    id: 'research-adapter-unavailable',
    version: 'unknown',
    os: process.platform,
    architecture: process.arch,
    topology: ['research-harness'],
  };
}

export function requestedIntent(scenario: SandboxScenario): ContainmentIntent {
  return {
    scenarioId: scenario.id,
    domain: scenario.domain,
    control: scenario.control,
    required: scenario.required,
    ...(scenario.parameters ? { parameters: scenario.parameters } : {}),
  };
}

function failedEvidence(
  scenario: SandboxScenario,
  backend: BackendInventory,
  recordedAt: string,
  reasonCode:
    | 'adapter_inspect_error'
    | 'adapter_scenario_error'
    | 'adapter_scenario_timeout',
  note: string,
): ControlEvidence {
  return {
    scenarioId: scenario.id,
    requestedIntent: requestedIntent(scenario),
    resolvedAdapterConfig: null,
    backend: { id: backend.id, version: backend.version },
    enforcementLocus: ['research-harness'],
    state: 'failed',
    basis: 'harness-observed',
    oracle: null,
    reasonCode,
    recordedAt,
    persistentMutations: [],
    notes: [note],
  };
}

async function runWithDeadline(
  adapter: ResearchSandboxAdapter,
  scenario: SandboxScenario,
  options: RunAdapterProbeOptions,
  now: () => string,
  timeoutMs: number,
): Promise<ControlEvidence> {
  const controller = new AbortController();
  const deadline = new Date(Date.now() + timeoutMs).toISOString();
  const timer = setTimeout(() => {
    controller.abort(new ScenarioTimeoutError(timeoutMs));
  }, timeoutMs);
  timer.unref();
  try {
    const evidence = await adapter.runScenario(scenario, {
      runId: options.runId,
      recordedAt: now,
      probeRoot: options.probeRoot,
      deadline,
      signal: controller.signal,
    });
    if (controller.signal.reason instanceof ScenarioTimeoutError) {
      throw controller.signal.reason;
    }
    return evidence;
  } catch (error) {
    if (controller.signal.reason instanceof ScenarioTimeoutError) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function diagnosticOptions(options: RunAdapterProbeOptions) {
  return {
    machinePaths: [options.probeRoot],
    sensitiveValues: options.adapter.sensitiveValues?.() ?? [],
  };
}

export async function runAdapterProbe(
  options: RunAdapterProbeOptions,
): Promise<SandboxProbeRun> {
  const now = options.now ?? (() => new Date().toISOString());
  const scenarioTimeoutMs =
    options.scenarioTimeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS;
  const onProgress =
    options.onProgress ??
    ((event: ProbeProgressEvent) => {
      process.stderr.write(
        `[sandbox-policy] ${event.index + 1}/${event.total} ${event.scenarioId} ${event.phase}\n`,
      );
    });
  const controls: ControlEvidence[] = [];
  const violations: SandboxProbeRun['violations'] = [];
  let backend = unavailableBackend();
  let cleanup: PersistentMutationEvidence[] = [];
  let cleanupComplete = false;
  let hostCapabilities: HostCapabilityEvidence[] = [];
  let inspected = false;
  let sensitiveDiagnosticRedactions = 0;
  const sanitizeError = (error: unknown): string =>
    sanitizeDiagnostic(
      error instanceof Error ? error.message : String(error),
      diagnosticOptions(options),
      () => {
        sensitiveDiagnosticRedactions += 1;
      },
    );

  try {
    try {
      backend = await options.adapter.inspect();
      inspected = true;
    } catch (error) {
      const message = sanitizeError(error);
      violations.push({ code: 'adapter_inspect_error', message });
      controls.push(
        ...options.catalog.scenarios.map((scenario) =>
          failedEvidence(
            scenario,
            backend,
            now(),
            'adapter_inspect_error',
            message,
          ),
        ),
      );
    }

    if (inspected) {
      for (const [index, scenario] of options.catalog.scenarios.entries()) {
        onProgress({
          scenarioId: scenario.id,
          domain: scenario.domain,
          index,
          total: options.catalog.scenarios.length,
          phase: 'started',
        });
        try {
          controls.push(
            await runWithDeadline(
              options.adapter,
              scenario,
              options,
              now,
              scenarioTimeoutMs,
            ),
          );
          onProgress({
            scenarioId: scenario.id,
            domain: scenario.domain,
            index,
            total: options.catalog.scenarios.length,
            phase: 'completed',
          });
        } catch (error) {
          const timedOut = error instanceof ScenarioTimeoutError;
          const message = sanitizeError(error);
          controls.push(
            failedEvidence(
              scenario,
              backend,
              now(),
              timedOut ? 'adapter_scenario_timeout' : 'adapter_scenario_error',
              message,
            ),
          );
          onProgress({
            scenarioId: scenario.id,
            domain: scenario.domain,
            index,
            total: options.catalog.scenarios.length,
            phase: timedOut ? 'timed-out' : 'failed',
          });
        }
      }

      try {
        hostCapabilities = await options.adapter.hostCapabilities();
      } catch (error) {
        violations.push({
          code: 'adapter_host_capabilities_error',
          message: sanitizeError(error),
        });
      }
    }
  } finally {
    try {
      cleanup = await options.adapter.close();
      cleanupComplete =
        cleanup.every((mutation) => mutation.cleanup === 'cleaned') &&
        controls.every((control) =>
          control.persistentMutations.every(
            (mutation) => mutation.cleanup !== 'residue',
          ),
        );
    } catch (error) {
      violations.push({
        code: 'adapter_cleanup_error',
        message: sanitizeError(error),
      });
      cleanupComplete = false;
    }
  }

  const run: SandboxProbeRun = {
    schemaVersion: 1,
    catalogVersion: options.catalog.catalogVersion,
    runId: options.runId,
    sourceRevision: options.sourceRevision,
    recordedAt: now(),
    backend,
    controls,
    hostCapabilities,
    cleanup,
    cleanupComplete,
    sensitiveDiagnosticRedactions,
    violations,
  };
  run.violations.push(...validateProbeRun(run));
  return run;
}
