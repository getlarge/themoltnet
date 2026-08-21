import path from 'node:path';

import type { DestinationConstraint, GovernanceIntent } from '../intent.js';
import type {
  SandboxAdapter,
  SandboxCleanupReport,
  SandboxHandle,
  SandboxLaunchPlan,
} from '../sandbox-adapter.js';
import {
  type CaseResult,
  type ConformanceCase,
  type ConformanceContext,
  SANDBOX_CONFORMANCE_CASES,
  type SharedLaunch,
  unsupportedResultFor,
} from './cases.js';
import type { ConformanceHarness, LoopbackDestination } from './harness.js';

export interface ConformanceRunOptions {
  adapter: SandboxAdapter;
  harness: ConformanceHarness;
  /** Maps a host workspace path to the guest-visible path. Default: identity. */
  guestPathFor?: (hostPath: string) => string;
  cases?: readonly ConformanceCase[];
  /** Run only these case ids. */
  only?: readonly string[];
  onProgress?: (message: string) => void;
}

export interface ConformanceSummary {
  adapter: { id: string; version: string };
  results: CaseResult[];
  passed: string[];
  failed: string[];
  unsupported: string[];
  skipped: string[];
  /** Aggregated cleanup over every handle the runner launched. */
  cleanup: SandboxCleanupReport;
}

export const CONFORMANCE_CREDENTIAL_ENV = 'CONFORMANCE_TOKEN';
export const CONFORMANCE_DENY_PATH = 'protected';

export function fixtureDestination(
  destination: LoopbackDestination,
  port: number,
): DestinationConstraint {
  const d = destination.destination;
  return {
    host: d.host,
    ...(d.scheme ? { scheme: d.scheme } : {}),
    ...(d.port === 'fixture'
      ? { port }
      : d.port !== undefined
        ? { port: d.port }
        : {}),
  };
}

export function buildConformanceIntent(
  harness: ConformanceHarness,
  adapter: SandboxAdapter,
  allowedPort: number,
): GovernanceIntent {
  const report = adapter.describe();
  const declared = new Set(
    report.capabilities
      .filter((c) => c.state === 'enforced')
      .map((c) => c.capability),
  );
  const prefer = (cap: Parameters<typeof declared.has>[0]) =>
    declared.has(cap) ? ('required' as const) : ('preferred' as const);
  const allowed = fixtureDestination(harness.loopback.allowed, allowedPort);
  return {
    ref: { id: 'conformance-profile', revision: 1 },
    toolPolicy: {
      enforcement: 'enforce',
      allowedTools: ['bash', 'sh', 'curl', 'printf', 'sleep', 'cat', 'mkdir'],
      allowedShellCommands: [['git', 'status']],
    },
    sandbox: {
      filesystem: {
        workspace: 'read-write',
        denyPaths: [CONFORMANCE_DENY_PATH],
        denyMode: 'deny',
      },
      network: {
        allowedDestinations: [allowed],
        allowedInternalHosts: [
          ...harness.loopback.allowed.allowedInternalHosts,
        ],
        // The suite accepts whatever platform egress the adapter declares;
        // the plan records it as effective policy rather than hiding it.
        acceptPlatformEgress: true,
      },
    },
    capabilities: {
      'filesystem-scope': prefer('filesystem-scope'),
      'network-egress': prefer('network-egress'),
      'child-process-containment': prefer('child-process-containment'),
      'host-env-isolation': prefer('host-env-isolation'),
      'timeout-cancellation': prefer('timeout-cancellation'),
      'brokered-credential': prefer('brokered-credential'),
    },
    credentials: [
      {
        id: 'conformance-api',
        purpose: 'conformance loopback fixture',
        consumer: 'guest-process',
        destinations: [allowed],
        delivery: 'brokered-http',
        envName: CONFORMANCE_CREDENTIAL_ENV,
        required: declared.has('brokered-credential'),
      },
    ],
    runtimeInputs: [],
    context: [],
    hostPowers: ['host-exec', 'host-mcp'],
  };
}

export async function runSandboxConformance(
  options: ConformanceRunOptions,
): Promise<ConformanceSummary> {
  const { adapter, harness } = options;
  const guestPathFor = options.guestPathFor ?? ((p: string) => p);
  const report = adapter.describe();
  const cases = (options.cases ?? SANDBOX_CONFORMANCE_CASES).filter(
    (c) => !options.only || options.only.includes(c.id),
  );
  const log = options.onProgress ?? (() => undefined);

  const allowed = await harness.startLoopbackFixture(
    harness.syntheticCredential,
  );
  const denied = await harness.startLoopbackFixture(
    harness.syntheticCredential,
  );
  const intent = buildConformanceIntent(harness, adapter, allowed.port);
  const allowedDestination = intent.credentials[0].destinations;
  const workspace = harness.createWorkspace();
  const handles: SandboxHandle[] = [];

  const basePlan = (): SandboxLaunchPlan => ({
    workspace: { hostPath: workspace.hostPath, mode: 'read-write' },
    filesystem: intent.sandbox.filesystem,
    network: {
      requested: intent.sandbox.network,
      effective: {
        allowedDestinations: [
          ...intent.sandbox.network.allowedDestinations,
          ...report.network.mandatoryEgress,
        ],
        allowedInternalHosts: intent.sandbox.network.allowedInternalHosts,
      },
      fidelity: report.network.fidelity,
    },
    env: { CONFORMANCE_MARKER: '1' },
    credentials: [
      {
        requirementId: 'conformance-api',
        envName: CONFORMANCE_CREDENTIAL_ENV,
        destinations: allowedDestination,
        bindingRef: 'conformance:synthetic',
        probe: async () => ({ code: 'ready', provider: 'synthetic' }),
        resolve: async () => harness.syntheticCredential,
      },
    ],
    requirements: intent.capabilities,
    label: 'conformance',
  });

  let sharedPromise: Promise<SharedLaunch> | undefined;
  const ctx: ConformanceContext = {
    adapter,
    harness,
    report,
    intent,
    basePlan,
    fixtures: { allowed, denied },
    guestPath: (rel) => path.posix.join(guestPathFor(workspace.hostPath), rel),
    async launch(overrides) {
      const handle = await adapter.launch(
        { ...basePlan(), ...overrides },
        { onProgress: log },
      );
      handles.push(handle);
      return handle;
    },
    shared() {
      sharedPromise ??= (async () => {
        const handle = await adapter.launch(basePlan(), { onProgress: log });
        handles.push(handle);
        return { handle, workspace };
      })();
      return sharedPromise;
    },
  };

  const results: CaseResult[] = [];
  const residue: string[] = [];
  let cleaned = true;
  try {
    for (const c of cases) {
      log(`conformance ${c.id}: ${c.title}`);
      const short = unsupportedResultFor(c, report);
      if (short) {
        results.push(short);
        continue;
      }
      try {
        results.push(await c.run(ctx));
      } catch (error) {
        results.push({
          id: c.id,
          title: c.title,
          status: 'failed',
          details: [error instanceof Error ? error.message : String(error)],
          evidence: {},
        });
      }
    }
  } finally {
    for (const handle of handles) {
      try {
        const report = await handle.close();
        if (!report.cleaned) {
          cleaned = false;
          residue.push(...report.residue);
        }
      } catch (error) {
        cleaned = false;
        residue.push(
          `close threw: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    await allowed.close();
    await denied.close();
    workspace.cleanup();
  }

  return {
    adapter: { id: adapter.id, version: adapter.version },
    results,
    passed: results.filter((r) => r.status === 'passed').map((r) => r.id),
    failed: results.filter((r) => r.status === 'failed').map((r) => r.id),
    unsupported: results
      .filter((r) => r.status === 'unsupported')
      .map((r) => r.id),
    skipped: results.filter((r) => r.status === 'skipped').map((r) => r.id),
    cleanup: { cleaned, residue },
  };
}
