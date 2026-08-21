import type { RuntimeProfile, SandboxCapability } from '../profile.js';
import { resolveRuntimeProfile } from '../resolved.js';
import type {
  SandboxAdapter,
  SandboxCapabilityReport,
  SandboxHandle,
  SandboxLaunchPlan,
} from '../sandbox-adapter.js';
import { createRuntimeSession, findValueLeaks } from '../session.js';
import type { EnforcementState } from '../states.js';
import type { ConformanceHarness, LoopbackFixture } from './harness.js';
import { renderRecipe } from './recipes.js';

export type CaseStatus = 'passed' | 'failed' | 'unsupported' | 'skipped';

export interface CaseResult {
  id: string;
  title: string;
  status: CaseStatus;
  /** State the adapter truthfully reported for the control under test. */
  state?: EnforcementState;
  details: string[];
  /** Value-free evidence retained with the result. */
  evidence: Record<string, unknown>;
}

export interface ConformanceContext {
  adapter: SandboxAdapter;
  harness: ConformanceHarness;
  report: SandboxCapabilityReport;
  /** Portable profile the runner built for this adapter and harness. */
  profile: RuntimeProfile;
  /** Shared launched handle for read-mostly cases; the runner owns it. */
  shared(): Promise<SharedLaunch>;
  /** Dedicated launch for cases that close or relaunch. Caller closes. */
  launch(plan?: Partial<SandboxLaunchPlan>): Promise<SandboxHandle>;
  basePlan(): SandboxLaunchPlan;
  /** Guest path of the shared workspace. */
  guestPath(relativePath: string): string;
  fixtures: { allowed: LoopbackFixture; denied: LoopbackFixture };
}

export interface SharedLaunch {
  handle: SandboxHandle;
  workspace: { hostPath: string; exists(rel: string): boolean };
}

export interface ConformanceCase {
  id: string;
  title: string;
  /** Capabilities the case exercises; `unsupported` declarations short-circuit. */
  requires: readonly SandboxCapability[];
  run(ctx: ConformanceContext): Promise<CaseResult>;
}

function result(
  c: Pick<ConformanceCase, 'id' | 'title'>,
  status: CaseStatus,
  details: string[],
  evidence: Record<string, unknown> = {},
  state?: EnforcementState,
): CaseResult {
  return {
    id: c.id,
    title: c.title,
    status,
    ...(state ? { state } : {}),
    details,
    evidence,
  };
}

function pass(
  c: ConformanceCase,
  details: string[],
  evidence?: Record<string, unknown>,
) {
  return result(c, 'passed', details, evidence, 'enforced');
}
function fail(
  c: ConformanceCase,
  details: string[],
  evidence?: Record<string, unknown>,
) {
  return result(c, 'failed', details, evidence);
}

function declaredState(
  report: SandboxCapabilityReport,
  capability: SandboxCapability,
): EnforcementState {
  return (
    report.capabilities.find((c) => c.capability === capability)?.state ??
    'unsupported'
  );
}

/** Wrap an adapter so launches are counted and one capability is unsupported. */
function withUnsupported(
  adapter: SandboxAdapter,
  capability: SandboxCapability,
): SandboxAdapter & { launches: number; preflights: number } {
  const wrapped = {
    id: adapter.id,
    version: adapter.version,
    launches: 0,
    preflights: 0,
    describe(): SandboxCapabilityReport {
      const base = adapter.describe();
      return {
        ...base,
        capabilities: base.capabilities.map((c) =>
          c.capability === capability
            ? {
                ...c,
                state: 'unsupported' as const,
                reason: 'conformance: forced unsupported',
              }
            : c,
        ),
      };
    },
    preflight: (plan: SandboxLaunchPlan) => {
      wrapped.preflights += 1;
      return adapter.preflight(plan);
    },
    launch: (
      plan: SandboxLaunchPlan,
      options?: Parameters<SandboxAdapter['launch']>[1],
    ) => {
      wrapped.launches += 1;
      return adapter.launch(plan, options);
    },
  };
  return wrapped;
}

const requiredCapabilityMissing: ConformanceCase = {
  id: 'C01',
  title: 'required capability missing stops launch',
  requires: [],
  async run(ctx) {
    const spy = withUnsupported(ctx.adapter, 'resource-limits');
    const profile: RuntimeProfile = {
      ...ctx.profile,
      capabilities: {
        ...ctx.profile.capabilities,
        'resource-limits': 'required',
      },
    };
    const outcome = await resolveRuntimeProfile(profile, {
      sandbox: spy,
      workspace: { hostPath: ctx.basePlan().workspace.hostPath },
      credentials: {},
    });
    if (outcome.ok) {
      return fail(this, [
        'resolution succeeded with an unsupported required capability',
      ]);
    }
    const hit = outcome.failures.find(
      (f) =>
        f.code === 'capability_unsupported' &&
        f.capability === 'resource-limits',
    );
    if (!hit)
      return fail(this, ['no capability_unsupported failure'], {
        failures: outcome.failures,
      });
    if (spy.launches !== 0 || spy.preflights !== 0) {
      return fail(this, [
        `adapter was reached: launches=${spy.launches} preflights=${spy.preflights}`,
      ]);
    }
    return result(
      this,
      'passed',
      ['resolution refused before preflight and launch'],
      {
        failures: outcome.failures,
      },
      'failed',
    );
  },
};

const fsAllowedWrite: ConformanceCase = {
  id: 'C02',
  title: 'allowed filesystem write reaches the host workspace',
  requires: ['filesystem-scope'],
  async run(ctx) {
    const { handle, workspace } = await ctx.shared();
    const rel = 'allowed/marker.txt';
    const r = await handle.exec(
      renderRecipe({
        op: 'write-file',
        path: ctx.guestPath(rel),
        content: 'allowed',
      }),
    );
    if (r.exitCode !== 0) return fail(this, [`exit ${r.exitCode}`, r.stderr]);
    if (!workspace.exists(rel)) return fail(this, ['marker absent on host']);
    return pass(this, ['marker present on host']);
  },
};

const fsDeniedWrite: ConformanceCase = {
  id: 'C03',
  title: 'denied filesystem write never reaches the host',
  requires: ['filesystem-scope'],
  async run(ctx) {
    const { handle, workspace } = await ctx.shared();
    const rel = `${ctx.profile.sandbox.filesystem.denyPaths[0]}/marker.txt`;
    const r = await handle.exec(
      renderRecipe({
        op: 'write-file',
        path: ctx.guestPath(rel),
        content: 'denied',
      }),
    );
    if (workspace.exists(rel))
      return fail(this, ['marker reached the host'], { exitCode: r.exitCode });
    return pass(this, [`host marker absent; guest exit ${r.exitCode}`], {
      exitCode: r.exitCode,
    });
  },
};

const netAllowed: ConformanceCase = {
  id: 'C04',
  title: 'allowed network destination is reachable',
  requires: ['network-egress'],
  async run(ctx) {
    const { handle } = await ctx.shared();
    const before = ctx.fixtures.allowed.hits;
    const url = `http://${ctx.harness.loopback.allowed.guestHostname}:${ctx.fixtures.allowed.port}/allowed`;
    const r = await handle.exec(
      renderRecipe({
        op: 'http-get',
        url,
        resolveTo: ctx.harness.loopback.allowed.resolveTo,
      }),
    );
    const hits = ctx.fixtures.allowed.hits - before;
    if (r.exitCode !== 0 || hits < 1) {
      return fail(this, [`exit ${r.exitCode}, fixture hits ${hits}`, r.stderr]);
    }
    return pass(this, [`fixture received ${hits} request(s)`], { hits });
  },
};

const netDenied: ConformanceCase = {
  id: 'C05',
  title: 'adjacent denied destination receives zero requests',
  requires: ['network-egress'],
  async run(ctx) {
    const { handle } = await ctx.shared();
    const before = ctx.fixtures.denied.hits;
    const url = `http://${ctx.harness.loopback.denied.guestHostname}:${ctx.fixtures.denied.port}/denied`;
    const r = await handle.exec(
      renderRecipe({
        op: 'http-get',
        url,
        resolveTo: ctx.harness.loopback.denied.resolveTo,
      }),
    );
    const hits = ctx.fixtures.denied.hits - before;
    if (hits !== 0)
      return fail(this, [`denied fixture received ${hits} request(s)`]);
    if (r.exitCode === 0)
      return fail(this, [
        'guest request reported success against a denied destination',
      ]);
    return pass(
      this,
      [`guest exit ${r.exitCode}; denied fixture received 0 requests`],
      {
        exitCode: r.exitCode,
      },
    );
  },
};

const childProcess: ConformanceCase = {
  id: 'C06',
  title: 'child processes inherit the filesystem denial',
  requires: ['child-process-containment', 'filesystem-scope'],
  async run(ctx) {
    const { handle, workspace } = await ctx.shared();
    const rel = `${ctx.profile.sandbox.filesystem.denyPaths[0]}/child-marker.txt`;
    const r = await handle.exec(
      renderRecipe({
        op: 'write-file-via-child',
        path: ctx.guestPath(rel),
        content: 'child',
        depth: 2,
      }),
    );
    if (workspace.exists(rel))
      return fail(this, ['child process wrote the denied marker']);
    return pass(
      this,
      [`host marker absent after nested sh -c; exit ${r.exitCode}`],
      {
        exitCode: r.exitCode,
      },
    );
  },
};

const hardTimeout: ConformanceCase = {
  id: 'C07',
  title: 'hard timeout terminates the command',
  requires: ['timeout-cancellation'],
  async run(ctx) {
    const { handle } = await ctx.shared();
    const started = Date.now();
    const r = await handle.exec(renderRecipe({ op: 'sleep', seconds: 30 }), {
      timeoutMs: 1_500,
    });
    const elapsed = Date.now() - started;
    if (!r.timedOut)
      return fail(this, ['timedOut=false'], { elapsedMs: elapsed });
    if (elapsed > 15_000)
      return fail(this, [`took ${elapsed}ms to honor a 1.5s timeout`]);
    return pass(this, [`timed out after ${elapsed}ms`], { elapsedMs: elapsed });
  },
};

const cancellation: ConformanceCase = {
  id: 'C08',
  title: 'cancellation aborts the command',
  requires: ['timeout-cancellation'],
  async run(ctx) {
    const { handle } = await ctx.shared();
    const controller = new AbortController();
    const started = Date.now();
    const pending = handle.exec(renderRecipe({ op: 'sleep', seconds: 30 }), {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 500);
    const r = await pending;
    const elapsed = Date.now() - started;
    if (!r.cancelled)
      return fail(this, ['cancelled=false'], { elapsedMs: elapsed });
    if (elapsed > 15_000)
      return fail(this, [`took ${elapsed}ms to honor cancellation`]);
    return pass(this, [`cancelled after ${elapsed}ms`], { elapsedMs: elapsed });
  },
};

const cleanup: ConformanceCase = {
  id: 'C09',
  title: 'cleanup leaves no guest-local mutation behind',
  requires: [],
  async run(ctx) {
    const first = await ctx.launch();
    let report;
    try {
      await first.exec(
        renderRecipe({
          op: 'write-file',
          path: '/tmp/moltnet-conformance-residue',
          content: 'x',
        }),
      );
    } finally {
      report = await first.close();
    }
    if (!report.cleaned)
      return fail(this, ['cleanup reported residue'], {
        residue: report.residue,
      });
    const second = await ctx.launch();
    try {
      const r = await second.exec(
        renderRecipe({
          op: 'read-file',
          path: '/tmp/moltnet-conformance-residue',
        }),
      );
      if (r.exitCode === 0)
        return fail(this, ['residue visible in a fresh launch']);
      return pass(this, ['fresh launch does not see prior guest mutation'], {
        residue: report.residue,
      });
    } finally {
      await second.close();
    }
  },
};

const noHostEnv: ConformanceCase = {
  id: 'C10',
  title: 'guest inherits no arbitrary host environment',
  requires: ['host-env-isolation'],
  async run(ctx) {
    const { handle } = await ctx.shared();
    const r = await handle.exec(
      renderRecipe({ op: 'print-env', name: ctx.harness.hostSentinelEnvName }),
    );
    if (r.stdout.trim().length > 0)
      return fail(this, ['host sentinel visible in guest']);
    return pass(this, ['host sentinel absent from guest environment']);
  },
};

const missingCredentialBinding: ConformanceCase = {
  id: 'C11',
  title: 'missing credential binding stops launch',
  requires: [],
  async run(ctx) {
    const spy = withUnsupported(ctx.adapter, 'resource-limits');
    const profile: RuntimeProfile = {
      ...ctx.profile,
      credentials: [
        {
          id: 'conformance-api',
          purpose: 'conformance fixture',
          consumer: 'guest-process',
          destinationHosts: [...ctx.harness.loopback.allowed.allowedHosts],
          delivery: 'brokered-http',
          envName: 'CONFORMANCE_TOKEN',
          required: true,
        },
      ],
    };
    const outcome = await resolveRuntimeProfile(profile, {
      sandbox: spy,
      workspace: { hostPath: ctx.basePlan().workspace.hostPath },
      credentials: {},
    });
    if (outcome.ok)
      return fail(this, ['resolution succeeded without a credential binding']);
    const hit = outcome.failures.find(
      (f) => f.code === 'credential_binding_missing',
    );
    if (!hit)
      return fail(this, ['no credential_binding_missing failure'], {
        failures: outcome.failures,
      });
    if (spy.launches !== 0 || spy.preflights !== 0) {
      return fail(this, [
        `adapter reached: launches=${spy.launches} preflights=${spy.preflights}`,
      ]);
    }
    return result(
      this,
      'passed',
      ['resolution refused with a setup diagnostic'],
      {
        message: hit.message,
      },
      'failed',
    );
  },
};

const credentialOneDestination: ConformanceCase = {
  id: 'C12',
  title: 'credential reaches exactly one approved destination',
  requires: ['brokered-credential', 'network-egress'],
  async run(ctx) {
    const { handle } = await ctx.shared();
    const allowedBefore = ctx.fixtures.allowed.hits;
    const deniedBefore = ctx.fixtures.denied.hits;
    const allowedUrl = `http://${ctx.harness.loopback.allowed.guestHostname}:${ctx.fixtures.allowed.port}/cred`;
    const deniedUrl = `http://${ctx.harness.loopback.denied.guestHostname}:${ctx.fixtures.denied.port}/cred`;
    const ok = await handle.exec(
      renderRecipe({
        op: 'http-get',
        url: allowedUrl,
        bearerEnv: 'CONFORMANCE_TOKEN',
        resolveTo: ctx.harness.loopback.allowed.resolveTo,
      }),
    );
    const bad = await handle.exec(
      renderRecipe({
        op: 'http-get',
        url: deniedUrl,
        bearerEnv: 'CONFORMANCE_TOKEN',
        resolveTo: ctx.harness.loopback.denied.resolveTo,
      }),
    );
    const allowedHits = ctx.fixtures.allowed.hits - allowedBefore;
    const deniedHits = ctx.fixtures.denied.hits - deniedBefore;
    const details = [
      `allowed: exit ${ok.exitCode}, hits ${allowedHits}, expected credential seen ${ctx.fixtures.allowed.sawExpectedCredential}`,
      `denied: exit ${bad.exitCode}, hits ${deniedHits}`,
    ];
    if (
      ok.exitCode !== 0 ||
      allowedHits !== 1 ||
      !ctx.fixtures.allowed.sawExpectedCredential
    ) {
      return fail(this, [
        'approved destination did not receive the resolved credential exactly once',
        ...details,
      ]);
    }
    if (deniedHits !== 0 || bad.exitCode === 0) {
      return fail(this, ['adjacent destination was reached', ...details]);
    }
    return pass(this, details, { allowedHits, deniedHits });
  },
};

const credentialAbsent: ConformanceCase = {
  id: 'C13',
  title: 'credential value is absent from guest output and evidence',
  requires: ['brokered-credential'],
  async run(ctx) {
    const { handle } = await ctx.shared();
    const r = await handle.exec(
      renderRecipe({ op: 'print-env', name: 'CONFORMANCE_TOKEN' }),
    );
    const session = createRuntimeSession(
      {
        profile: ctx.profile.ref,
        policySnapshotHash: 'sha256:' + '0'.repeat(64),
        sandboxAdapter: { id: ctx.adapter.id, version: ctx.adapter.version },
        capabilities: [],
        hostPowers: [],
        credentialBindings: [],
        contextInputs: [],
        launchPlanDigest: 'sha256:' + '0'.repeat(64),
        resolvedAt: new Date(0).toISOString(),
      },
      { id: 'conformance' },
    );
    for (const record of handle.observe()) session.recordEnforcement(record);
    const finished = session.finish('completed');
    const leaks = findValueLeaks(ctx.harness.syntheticCredential, {
      stdout: r.stdout,
      stderr: r.stderr,
      observe: handle.observe(),
      session: finished,
      plan: {
        ...ctx.basePlan(),
        credentials: ctx.basePlan().credentials.map((binding) => ({
          requirementId: binding.requirementId,
          envName: binding.envName,
          destinationHosts: binding.destinationHosts,
          bindingRef: binding.bindingRef,
        })),
      },
    });
    if (leaks.length > 0)
      return fail(this, [`credential value present in: ${leaks.join(', ')}`]);
    if (r.stdout.trim().length === 0) {
      return fail(this, ['guest saw no stand-in for the credential env']);
    }
    return pass(this, [
      'guest saw a stand-in; value absent from output, observations, session, and plan evidence',
    ]);
  },
};

const hostPowersOutside: ConformanceCase = {
  id: 'C14',
  title: 'host exec and host MCP are reported outside guest containment',
  requires: [],
  async run(ctx) {
    const powers = ctx.report.hostPowers;
    const missing = (['host-exec', 'host-mcp'] as const).filter(
      (p) => !powers.some((h) => h.power === p),
    );
    if (missing.length > 0)
      return fail(this, [`report omits ${missing.join(', ')}`]);
    const claimed = powers.filter(
      (h) => (h.locus as string) === 'guest-sandbox',
    );
    if (claimed.length > 0)
      return fail(this, ['a host power is claimed inside the guest sandbox']);
    const { handle } = await ctx.shared();
    const inGuest = handle
      .observe()
      .filter(
        (r) =>
          (r.control === 'host-exec' || r.control === 'host-mcp') &&
          r.state === 'enforced' &&
          r.locus === 'guest-sandbox',
      );
    if (inGuest.length > 0)
      return fail(this, [
        'observe() claims host power enforcement inside the guest',
      ]);
    return result(
      this,
      'passed',
      powers.map((p) => `${p.power}: ${p.locus}`),
      { powers },
      'unsupported',
    );
  },
};

const adapterDisappearance: ConformanceCase = {
  id: 'C15',
  title:
    'adapter disappearance is reported as failed, degraded, or failed-open',
  requires: [],
  async run(ctx) {
    const handle = await ctx.launch();
    await handle.close();
    let threw = false;
    let after: Awaited<ReturnType<SandboxHandle['exec']>> | undefined;
    try {
      after = await handle.exec(
        renderRecipe({ op: 'print-env', name: 'HOME' }),
      );
    } catch {
      threw = true;
    }
    if (!threw && after && after.exitCode === 0 && !after.cancelled) {
      return fail(this, ['exec succeeded after close']);
    }
    // Latest record per control wins; history is retained for evidence.
    const latest = new Map<string, EnforcementState>();
    for (const r of handle.observe()) latest.set(r.control, r.state);
    const states = [...latest.values()];
    const claimsEnforced = [...latest.entries()].some(
      ([control, state]) =>
        state === 'enforced' &&
        ctx.profile.capabilities[control as SandboxCapability] !== undefined,
    );
    if (claimsEnforced) {
      return fail(
        this,
        ['observe() still reports requested controls as enforced after close'],
        { states },
      );
    }
    return result(
      this,
      'passed',
      ['post-close exec refused; no enforced claim survives close'],
      {
        states: [...new Set(states)],
        threw,
      },
      threw ? 'failed' : 'degraded',
    );
  },
};

export const SANDBOX_CONFORMANCE_CASES: readonly ConformanceCase[] =
  Object.freeze([
    requiredCapabilityMissing,
    fsAllowedWrite,
    fsDeniedWrite,
    netAllowed,
    netDenied,
    childProcess,
    hardTimeout,
    cancellation,
    cleanup,
    noHostEnv,
    missingCredentialBinding,
    credentialOneDestination,
    credentialAbsent,
    hostPowersOutside,
    adapterDisappearance,
  ]);

/** Short-circuit a case whose capability the adapter honestly declares unsupported. */
export function unsupportedResultFor(
  c: ConformanceCase,
  report: SandboxCapabilityReport,
): CaseResult | undefined {
  for (const capability of c.requires) {
    const state = declaredState(report, capability);
    if (state === 'unsupported') {
      return result(
        c,
        'unsupported',
        [`adapter ${report.adapter.id} declares ${capability} unsupported`],
        { capability },
        'unsupported',
      );
    }
  }
  return undefined;
}
