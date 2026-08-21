import path from 'node:path';

import type { RuntimeProfile } from '../profile.js';
import type {
  SandboxAdapter,
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
import type { ConformanceHarness } from './harness.js';

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
}

export const CONFORMANCE_CREDENTIAL_ENV = 'CONFORMANCE_TOKEN';
export const CONFORMANCE_DENY_PATH = 'protected';

export function buildConformanceProfile(
  harness: ConformanceHarness,
  adapter: SandboxAdapter,
): RuntimeProfile {
  const declared = new Set(
    adapter
      .describe()
      .capabilities.filter((c) => c.state === 'enforced')
      .map((c) => c.capability),
  );
  const prefer = (cap: Parameters<typeof declared.has>[0]) =>
    declared.has(cap) ? ('required' as const) : ('preferred' as const);
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
        allowedHosts: [...harness.loopback.allowed.allowedHosts],
        allowedInternalHosts: [
          ...harness.loopback.allowed.allowedInternalHosts,
        ],
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
        destinationHosts: [...harness.loopback.allowed.allowedHosts],
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
  const profile = buildConformanceProfile(harness, adapter);
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
  const workspace = harness.createWorkspace();
  const handles: SandboxHandle[] = [];

  const basePlan = (): SandboxLaunchPlan => ({
    workspace: { hostPath: workspace.hostPath, mode: 'read-write' },
    filesystem: profile.sandbox.filesystem,
    network: profile.sandbox.network,
    env: { CONFORMANCE_MARKER: '1' },
    credentials: [
      {
        requirementId: 'conformance-api',
        envName: CONFORMANCE_CREDENTIAL_ENV,
        destinationHosts: profile.credentials[0].destinationHosts,
        bindingRef: 'conformance:synthetic',
        resolve: async () => harness.syntheticCredential,
      },
    ],
    requirements: profile.capabilities,
    label: 'conformance',
  });

  let sharedPromise: Promise<SharedLaunch> | undefined;
  const ctx: ConformanceContext = {
    adapter,
    harness,
    report,
    profile,
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
        await handle.close();
      } catch {
        // Already closed by a case; cleanup is idempotent for the suite.
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
  };
}
