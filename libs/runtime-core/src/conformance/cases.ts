import type { GovernanceIntent, SandboxCapability } from '../intent.js';
import { resolveGovernanceIntent } from '../plan.js';
import type {
  EnforcementRecord,
  SandboxAdapter,
  SandboxCapabilityReport,
  SandboxHandle,
  SandboxLaunchPlan,
} from '../sandbox-adapter.js';
import { createGovernanceSession, findValueLeaks } from '../session.js';
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
  /** Portable intent the runner built for this adapter and harness. */
  intent: GovernanceIntent;
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

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

/** Latest record per control. */
function latestRecords(handle: SandboxHandle): Map<string, EnforcementRecord> {
  const latest = new Map<string, EnforcementRecord>();
  for (const r of handle.observe()) latest.set(r.control, r);
  return latest;
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
    const intent: GovernanceIntent = {
      ...ctx.intent,
      capabilities: {
        ...ctx.intent.capabilities,
        'resource-limits': 'required',
      },
    };
    const outcome = await resolveGovernanceIntent(intent, {
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
      { failures: outcome.failures },
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
    const rel = `${ctx.intent.sandbox.filesystem.denyPaths[0]}/marker.txt`;
    const r = await handle.exec(
      renderRecipe({
        op: 'write-file',
        path: ctx.guestPath(rel),
        content: 'denied',
      }),
    );
    if (workspace.exists(rel))
      return fail(this, ['marker reached the host'], { exitCode: r.exitCode });
    const applied = latestRecords(handle).get('filesystem-scope');
    if (!applied || applied.basis === 'declared') {
      return fail(this, [
        'adapter did not record filesystem-scope as applied for this launch',
      ]);
    }
    return pass(this, [`host marker absent; guest exit ${r.exitCode}`], {
      exitCode: r.exitCode,
      basis: applied.basis,
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
      { exitCode: r.exitCode, fidelity: ctx.report.network.fidelity },
    );
  },
};

const childProcess: ConformanceCase = {
  id: 'C06',
  title: 'child processes inherit the filesystem denial',
  requires: ['child-process-containment', 'filesystem-scope'],
  async run(ctx) {
    const { handle, workspace } = await ctx.shared();
    const rel = `${ctx.intent.sandbox.filesystem.denyPaths[0]}/child-marker.txt`;
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
      { exitCode: r.exitCode },
    );
  },
};

/**
 * Timeout and cancellation are proven by a delayed side effect: the command
 * sleeps, then writes a marker from a child shell. If the guest process group
 * was really terminated, the marker never appears on the host even after
 * the delay has elapsed.
 */
async function proveTermination(
  c: ConformanceCase,
  ctx: ConformanceContext,
  mode: 'timeout' | 'cancel',
): Promise<CaseResult> {
  const { handle, workspace } = await ctx.shared();
  const rel = `late/${mode}.marker`;
  const delaySeconds = 3;
  const controller = new AbortController();
  const started = Date.now();
  const pending = handle.exec(
    renderRecipe({
      op: 'delayed-write',
      path: ctx.guestPath(rel),
      content: 'late',
      delaySeconds,
      viaChild: true,
    }),
    mode === 'timeout' ? { timeoutMs: 800 } : { signal: controller.signal },
  );
  if (mode === 'cancel') setTimeout(() => controller.abort(), 500);
  const r = await pending;
  const elapsed = Date.now() - started;
  const flag = mode === 'timeout' ? r.timedOut : r.cancelled;
  if (!flag) return fail(c, [`${mode} flag not set`], { elapsedMs: elapsed });
  if (elapsed > 15_000)
    return fail(c, [`took ${elapsed}ms to honor ${mode}`], {
      elapsedMs: elapsed,
    });
  // Wait past the delay; a surviving process would write the marker now.
  await sleep(delaySeconds * 1000 + 1_500);
  if (workspace.exists(rel)) {
    return fail(
      c,
      [
        `${mode} returned after ${elapsed}ms but the guest process group kept running and wrote the marker`,
      ],
      { elapsedMs: elapsed, terminationConfirmed: r.terminationConfirmed },
    );
  }
  if (r.terminationConfirmed !== true) {
    return fail(c, [
      'marker absent but the adapter did not confirm termination of the guest process group',
    ]);
  }
  return pass(
    c,
    [
      `${mode} after ${elapsed}ms; delayed marker absent after ${delaySeconds}s; termination confirmed`,
    ],
    { elapsedMs: elapsed },
  );
}

const hardTimeout: ConformanceCase = {
  id: 'C07',
  title: 'hard timeout terminates the guest process group',
  requires: ['timeout-cancellation'],
  run(ctx) {
    return proveTermination(this, ctx, 'timeout');
  },
};

const cancellation: ConformanceCase = {
  id: 'C08',
  title: 'cancellation terminates the guest process group',
  requires: ['timeout-cancellation'],
  run(ctx) {
    return proveTermination(this, ctx, 'cancel');
  },
};

const cleanup: ConformanceCase = {
  id: 'C09',
  title: 'cleanup leaves no guest-local mutation behind and is idempotent',
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
    const again = await first.close();
    if (again.cleaned !== report.cleaned) {
      return fail(this, ['second close() disagreed with the first']);
    }
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
  title: 'missing or untrusted credential binding stops launch',
  requires: [],
  async run(ctx) {
    const spy = withUnsupported(ctx.adapter, 'resource-limits');
    const requirement = ctx.intent.credentials[0];
    const intent: GovernanceIntent = {
      ...ctx.intent,
      credentials: [{ ...requirement, required: true }],
    };
    const missing = await resolveGovernanceIntent(intent, {
      sandbox: spy,
      workspace: { hostPath: ctx.basePlan().workspace.hostPath },
      credentials: {},
    });
    if (missing.ok)
      return fail(this, ['resolution succeeded without a credential binding']);
    const hitMissing = missing.failures.find(
      (f) => f.code === 'credential_binding_missing',
    );
    if (!hitMissing)
      return fail(this, ['no credential_binding_missing failure'], {
        failures: missing.failures,
      });
    // A binding exists but is narrower than the requirement: the trusted
    // side wins and resolution refuses the broader request.
    const broader = await resolveGovernanceIntent(
      {
        ...intent,
        credentials: [
          {
            ...requirement,
            required: true,
            destinations: [
              ...requirement.destinations,
              { host: 'other.invalid' },
            ],
          },
        ],
      },
      {
        sandbox: spy,
        workspace: { hostPath: ctx.basePlan().workspace.hostPath },
        credentials: {
          [requirement.id]: {
            requirementId: requirement.id,
            envName: requirement.envName,
            destinations: requirement.destinations,
            bindingRef: 'conformance:narrow',
            probe: async () => ({ code: 'ready' }),
            resolve: async () => 'never',
          },
        },
      },
    );
    if (
      broader.ok ||
      !broader.failures.some(
        (f) => f.code === 'credential_destination_not_trusted',
      )
    ) {
      return fail(this, [
        'a requirement broader than its trusted binding was not refused',
      ]);
    }
    if (spy.launches !== 0 || spy.preflights !== 0) {
      return fail(this, [
        `adapter reached: launches=${spy.launches} preflights=${spy.preflights}`,
      ]);
    }
    return result(
      this,
      'passed',
      [
        'missing binding refused with a setup diagnostic; broader-than-trusted destination refused',
      ],
      { message: hitMissing.message },
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
      `fidelity: ${ctx.report.network.fidelity}`,
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
    return pass(this, details, {
      allowedHits,
      deniedHits,
      fidelity: ctx.report.network.fidelity,
    });
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
    const outcome = await resolveGovernanceIntent(ctx.intent, {
      sandbox: ctx.adapter,
      workspace: { hostPath: ctx.basePlan().workspace.hostPath },
      credentials: Object.fromEntries(
        ctx.basePlan().credentials.map((b) => [b.requirementId, b]),
      ),
    });
    if (!outcome.ok) {
      return fail(this, ['conformance intent did not resolve'], {
        failures: outcome.failures,
      });
    }
    const session = createGovernanceSession(outcome.plan, {
      id: 'conformance',
    });
    for (const record of handle.observe()) session.recordEnforcement(record);
    const finished = session.finish('completed');
    const leaks = findValueLeaks(ctx.harness.syntheticCredential, {
      stdout: r.stdout,
      stderr: r.stderr,
      observe: handle.observe(),
      plan: outcome.plan,
      session: finished,
      launchPlanWithoutResolvers: {
        ...outcome.launchPlan,
        credentials: outcome.launchPlan.credentials.map((b) => ({
          requirementId: b.requirementId,
          envName: b.envName,
          destinations: b.destinations,
          bindingRef: b.bindingRef,
        })),
      },
    });
    if (leaks.length > 0)
      return fail(this, [`credential value present in: ${leaks.join(', ')}`]);
    if (r.stdout.trim().length === 0) {
      return fail(this, ['guest saw no stand-in for the credential env']);
    }
    return pass(this, [
      'guest saw a stand-in; value absent from output, observations, plan, session, and launch plan',
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
    const latest = latestRecords(handle);
    const states = [...latest.values()].map((r) => r.state);
    const claimsEnforced = [...latest.entries()].some(
      ([control, record]) =>
        record.state === 'enforced' &&
        ctx.intent.capabilities[control as SandboxCapability] !== undefined,
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
      { states: [...new Set(states)], threw },
      threw ? 'failed' : 'degraded',
    );
  },
};

/**
 * Same-host destination narrowing. An adapter with `host` fidelity must not
 * resolve a port-scoped required destination as enforced; an adapter with
 * finer fidelity must actually deny the adjacent port on the same host.
 */
const destinationFidelity: ConformanceCase = {
  id: 'C16',
  title: 'same-host port narrowing is enforced or honestly degraded',
  requires: ['network-egress'],
  async run(ctx) {
    const fidelity = ctx.report.network.fidelity;
    const allowed = ctx.intent.sandbox.network.allowedDestinations[0];
    const portScoped: GovernanceIntent = {
      ...ctx.intent,
      capabilities: {
        ...ctx.intent.capabilities,
        'network-egress': 'required',
      },
      sandbox: {
        ...ctx.intent.sandbox,
        network: {
          ...ctx.intent.sandbox.network,
          allowedDestinations: [
            { host: allowed.host, port: ctx.fixtures.allowed.port },
          ],
        },
      },
      credentials: [],
    };
    const outcome = await resolveGovernanceIntent(portScoped, {
      sandbox: ctx.adapter,
      workspace: { hostPath: ctx.basePlan().workspace.hostPath },
      credentials: {},
    });
    if (fidelity === 'host') {
      if (outcome.ok) {
        return fail(this, [
          'adapter with host fidelity resolved a required port-scoped destination as enforced',
        ]);
      }
      const hit = outcome.failures.find(
        (f) =>
          f.code === 'capability_degraded' && f.capability === 'network-egress',
      );
      if (!hit) {
        return fail(
          this,
          ['port-scoped destination was refused for the wrong reason'],
          {
            failures: outcome.failures,
          },
        );
      }
      return result(
        this,
        'passed',
        [
          'host-only fidelity: port-scoped required egress resolved as degraded and refused',
        ],
        { fidelity },
        'degraded',
      );
    }
    if (!outcome.ok) {
      return fail(this, ['port-scoped destination did not resolve'], {
        failures: outcome.failures,
      });
    }
    // Same hostname as the allowed fixture, adjacent fixture port.
    const { handle } = await ctx.shared();
    const before = ctx.fixtures.denied.hits;
    const url = `http://${ctx.harness.loopback.allowed.guestHostname}:${ctx.fixtures.denied.port}/port`;
    const r = await handle.exec(
      renderRecipe({
        op: 'http-get',
        url,
        resolveTo: ctx.harness.loopback.allowed.resolveTo,
      }),
    );
    const hits = ctx.fixtures.denied.hits - before;
    if (hits !== 0 || r.exitCode === 0) {
      return fail(this, [
        `same-host adjacent port was reachable (exit ${r.exitCode}, hits ${hits})`,
      ]);
    }
    return pass(this, [`same-host adjacent port denied (exit ${r.exitCode})`], {
      fidelity,
    });
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
    destinationFidelity,
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
