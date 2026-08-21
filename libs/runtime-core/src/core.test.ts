import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createReferenceSandboxAdapter } from './conformance/reference-adapter.js';
import { canonicalJson, deepFreezeClone, sha256Digest } from './digest.js';
import {
  assertPortableGovernanceIntent,
  type CredentialRequirement,
  type GovernanceIntent,
  GovernanceIntentValidationError,
} from './intent.js';
import { resolveGovernanceIntent } from './plan.js';
import type {
  BrokeredCredentialBinding,
  CredentialReadinessCode,
  SandboxAdapter,
  SandboxLaunchPlan,
} from './sandbox-adapter.js';
import {
  createGovernanceSession,
  decisionFromGateVerdict,
  findValueLeaks,
  summarizeEnforcement,
} from './session.js';
import { stateForUnavailableControl } from './states.js';

function intent(overrides: Partial<GovernanceIntent> = {}): GovernanceIntent {
  return {
    ref: { id: 'p1', revision: 3, definitionCid: 'bafy-test' },
    toolPolicy: {
      enforcement: 'enforce',
      allowedTools: ['git', 'mcp__probe__probe_echo'],
      allowedShellCommands: [['git', 'status']],
    },
    sandbox: {
      filesystem: {
        workspace: 'read-write',
        denyPaths: ['secrets'],
        denyMode: 'deny',
      },
      network: {
        allowedDestinations: [{ host: 'api.example.test' }],
        allowedInternalHosts: [],
        acceptPlatformEgress: true,
      },
    },
    capabilities: {
      'filesystem-scope': 'required',
      'network-egress': 'preferred',
    },
    credentials: [],
    runtimeInputs: [],
    context: [{ slug: 'repo-conventions', binding: 'skill' }],
    hostPowers: ['host-exec'],
    ...overrides,
  };
}

function requirement(
  id: string,
  required = true,
  overrides: Partial<CredentialRequirement> = {},
): CredentialRequirement {
  return {
    id,
    purpose: `use ${id}`,
    consumer: 'guest-process',
    destinations: [{ host: 'api.example.test' }],
    delivery: 'brokered-http',
    envName: id.toUpperCase().replace(/-/g, '_'),
    required,
    ...overrides,
  };
}

function binding(
  id: string,
  code: CredentialReadinessCode = 'ready',
  overrides: Partial<BrokeredCredentialBinding> = {},
): BrokeredCredentialBinding {
  return {
    requirementId: id,
    envName: id.toUpperCase().replace(/-/g, '_'),
    destinations: [{ host: 'api.example.test' }],
    bindingRef: `keyring:${id}`,
    probe: async () => ({
      code,
      provider: 'os-keyring',
      ...(code === 'ready' ? {} : { setupInstruction: `fix ${id}` }),
    }),
    resolve: async () => 'super-secret-value',
    ...overrides,
  };
}

function bindings(
  adapter: SandboxAdapter,
  extra: Partial<Parameters<typeof resolveGovernanceIntent>[1]> = {},
) {
  return {
    sandbox: adapter,
    workspace: { hostPath: '/tmp/does-not-matter' },
    credentials: {},
    now: () => new Date('2026-08-21T00:00:00Z'),
    ...extra,
  };
}

describe('states', () => {
  it('maps a lost control to failed, degraded, or failed-open by requirement', () => {
    expect(stateForUnavailableControl('required', 'enforced')).toBe('failed');
    expect(stateForUnavailableControl('preferred', 'enforced')).toBe(
      'degraded',
    );
    expect(stateForUnavailableControl('none', 'enforced')).toBe('failed-open');
    expect(stateForUnavailableControl('none', 'unsupported')).toBe(
      'unsupported',
    );
  });
});

describe('canonical JSON', () => {
  it('matches the cross-language vectors shared with crypto-service', () => {
    const fixture = JSON.parse(
      readFileSync(
        path.resolve(
          import.meta.dirname,
          '../../../test-fixtures/executor-attestation-v1.json',
        ),
        'utf8',
      ),
    ) as {
      canonicalJsonVectors: { value: unknown; canonical: string }[];
      vectors: { payload: unknown; canonical: string; sha256: string }[];
    };
    for (const v of fixture.canonicalJsonVectors) {
      expect(canonicalJson(v.value)).toBe(v.canonical);
    }
    for (const v of fixture.vectors) {
      expect(canonicalJson(v.payload)).toBe(v.canonical);
      expect(sha256Digest(v.payload)).toBe(`sha256:${v.sha256}`);
    }
  });

  it('deep-freezes clones without aliasing the source', () => {
    const source = { a: { b: [1, { c: 2 }] }, f: () => 1, u: undefined };
    const frozen = deepFreezeClone(source);
    expect(Object.isFrozen(frozen.a.b[1])).toBe(true);
    expect(frozen.a).not.toBe(source.a);
    expect('u' in frozen).toBe(false);
    expect(frozen.f).toBe(source.f);
  });
});

describe('assertPortableGovernanceIntent', () => {
  it('applies the stored profile shape limits and the portability boundary', () => {
    const bad = intent({
      toolPolicy: {
        enforcement: 'enforce',
        allowedTools: [],
        allowedShellCommands: [['git']],
      },
      sandbox: {
        filesystem: {
          workspace: 'read-write',
          denyPaths: ['/Users/someone/.ssh'],
          denyMode: 'deny',
        },
        network: {
          allowedDestinations: [
            { host: 'https://bad.example' },
            { host: 'ok.example', port: 70_000 },
          ],
          allowedInternalHosts: ['not a host'],
          acceptPlatformEgress: true,
        },
        resources: { memory: '2 gigs', cpus: 1.5 },
      },
      credentials: [
        requirement('gh', true, { destinations: [], envName: 'lowercase' }),
        {
          ...requirement('gh', true, { envName: 'lowercase' }),
          ...({ value: 'ghp_leak' } as object),
        },
      ],
    });
    expect(() => assertPortableGovernanceIntent(bad)).toThrow(
      GovernanceIntentValidationError,
    );
    try {
      assertPortableGovernanceIntent(bad);
    } catch (error) {
      const issues = (error as GovernanceIntentValidationError).issues.join(
        '\n',
      );
      for (const needle of [
        'two tokens',
        'host path',
        'not a hostname pattern',
        'out of range',
        'resources.memory',
        'resources.cpus',
        'declared twice',
        'used by more than one',
        'at least one destination',
        'environment variable name',
        'value-free',
      ]) {
        expect(issues).toContain(needle);
      }
    }
  });
});

describe('resolveGovernanceIntent', () => {
  it('produces a deeply frozen, value-free plan with digests and verdicts', async () => {
    const adapter = createReferenceSandboxAdapter({
      mandatoryEgress: [{ host: 'registry.example' }],
    });
    const resolve = vi.fn(async () => 'super-secret-value');
    const outcome = await resolveGovernanceIntent(
      intent({ credentials: [requirement('api')], runtimeInputs: ['REGION'] }),
      bindings(adapter, {
        credentials: { api: binding('api', 'ready', { resolve }) },
        runtimeInputs: { REGION: 'eu-west-1' },
        contextInputs: {
          'repo-conventions': { revision: 'r7', provenance: 'pack:abc' },
        },
        policySnapshotHash: `sha256:${'a'.repeat(64)}`,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { plan, launchPlan } = outcome;
    expect(resolve).not.toHaveBeenCalled();
    expect(plan.profile).toEqual({
      id: 'p1',
      revision: 3,
      definitionCid: 'bafy-test',
    });
    expect(plan.policySnapshotHash).toBe(`sha256:${'a'.repeat(64)}`);
    expect(plan.sandboxAdapter.id).toBe('reference-in-memory');
    expect(
      plan.capabilities.find((c) => c.capability === 'filesystem-scope'),
    ).toMatchObject({
      requested: 'required',
      declared: 'enforced',
      locus: 'guest-sandbox',
    });
    expect(
      plan.capabilities.find((c) => c.capability === 'brokered-credential')
        ?.requested,
    ).toBe('required');
    expect(plan.network).toEqual({
      requested: {
        allowedDestinations: [{ host: 'api.example.test' }],
        allowedInternalHosts: [],
        acceptPlatformEgress: true,
      },
      effective: {
        allowedDestinations: [
          { host: 'api.example.test' },
          { host: 'registry.example' },
        ],
        allowedInternalHosts: [],
      },
      mandatoryEgress: [{ host: 'registry.example' }],
      fidelity: 'host-port',
    });
    expect(plan.credentialBindings).toEqual([
      {
        requirementId: 'api',
        envName: 'API',
        destinations: [{ host: 'api.example.test' }],
        bindingRef: 'keyring:api',
        provider: 'os-keyring',
        readiness: 'ready',
      },
    ]);
    expect(plan.contextInputs).toEqual([
      {
        slug: 'repo-conventions',
        binding: 'skill',
        revision: 'r7',
        provenance: 'pack:abc',
      },
    ]);
    expect(plan.hostPowers).toEqual([
      { power: 'host-exec', locus: 'outside-containment' },
    ]);
    expect(plan.launchPlanDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(plan.planDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    const { planDigest, ...rest } = plan;
    expect(sha256Digest(rest)).toBe(planDigest);
    const serialized = JSON.stringify(plan);
    for (const forbidden of [
      'super-secret-value',
      '/tmp/does-not-matter',
      'eu-west-1',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // Deep immutability of both artefacts.
    expect(Object.isFrozen(plan.capabilities[0])).toBe(true);
    expect(Object.isFrozen(plan.network.effective.allowedDestinations)).toBe(
      true,
    );
    expect(Object.isFrozen(launchPlan.filesystem.denyPaths)).toBe(true);
    expect(Object.isFrozen(launchPlan.credentials[0])).toBe(true);
    expect(() => {
      (launchPlan.filesystem.denyPaths as string[]).push('x');
    }).toThrow();
    expect(launchPlan.env).toEqual({ REGION: 'eu-west-1' });
    expect(launchPlan.workspace.hostPath).toBe('/tmp/does-not-matter');
  });

  it('yields the same digests on two machines with different host paths', async () => {
    const adapter = createReferenceSandboxAdapter();
    const a = await resolveGovernanceIntent(
      intent(),
      bindings(adapter, { workspace: { hostPath: '/a' } }),
    );
    const b = await resolveGovernanceIntent(
      intent(),
      bindings(adapter, { workspace: { hostPath: '/b' } }),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.plan.launchPlanDigest).toBe(b.plan.launchPlanDigest);
    expect(a.plan.planDigest).toBe(b.plan.planDigest);
  });

  it('digests the tool policy when the server hash is absent', async () => {
    const outcome = await resolveGovernanceIntent(
      intent(),
      bindings(createReferenceSandboxAdapter()),
    );
    expect(outcome.ok && outcome.plan.policySnapshotHash).toBe(
      sha256Digest(intent().toolPolicy),
    );
  });

  it('stops before preflight when a required capability is unsupported', async () => {
    const adapter = createReferenceSandboxAdapter({
      unsupported: ['filesystem-scope'],
    });
    let preflights = 0;
    const spy: SandboxAdapter = {
      ...adapter,
      preflight: (plan: SandboxLaunchPlan) => {
        preflights += 1;
        return adapter.preflight(plan);
      },
    };
    const outcome = await resolveGovernanceIntent(intent(), bindings(spy));
    expect(outcome).toMatchObject({
      ok: false,
      failures: [
        { code: 'capability_unsupported', capability: 'filesystem-scope' },
      ],
    });
    expect(preflights).toBe(0);
  });

  it('degrades network-egress when the intent rejects mandatory platform egress', async () => {
    const adapter = createReferenceSandboxAdapter({
      mandatoryEgress: [{ host: 'registry.example' }],
    });
    const base = intent();
    const rejecting = intent({
      capabilities: { 'network-egress': 'required' },
      sandbox: {
        ...base.sandbox,
        network: { ...base.sandbox.network, acceptPlatformEgress: false },
      },
    });
    const outcome = await resolveGovernanceIntent(rejecting, bindings(adapter));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures[0]).toMatchObject({
      code: 'capability_degraded',
      capability: 'network-egress',
    });
    expect(outcome.failures[0]?.message).toContain('registry.example');
  });

  it('degrades network-egress for destinations narrower than the adapter fidelity', async () => {
    const adapter = createReferenceSandboxAdapter({ fidelity: 'host' });
    const base = intent();
    const portScoped = intent({
      capabilities: { 'network-egress': 'required' },
      sandbox: {
        ...base.sandbox,
        network: {
          ...base.sandbox.network,
          allowedDestinations: [{ host: 'api.example.test', port: 8443 }],
        },
      },
    });
    const outcome = await resolveGovernanceIntent(
      portScoped,
      bindings(adapter),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures[0]).toMatchObject({
      code: 'capability_degraded',
      capability: 'network-egress',
    });
    expect(outcome.failures[0]?.message).toContain('api.example.test:8443');
  });

  it('warns instead of failing when a preferred capability is unsupported', async () => {
    const adapter = createReferenceSandboxAdapter({
      unsupported: ['network-egress'],
    });
    const outcome = await resolveGovernanceIntent(intent(), bindings(adapter));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.warnings).toContainEqual(
      expect.objectContaining({
        code: 'capability_unsupported',
        capability: 'network-egress',
      }),
    );
    expect(outcome.warnings).toContainEqual(
      expect.objectContaining({ code: 'context_input_unpinned' }),
    );
    expect(
      outcome.plan.capabilities.find((c) => c.capability === 'network-egress')
        ?.declared,
    ).toBe('unsupported');
  });

  it('refuses a requirement broader than its trusted binding and a mismatched binding identity', async () => {
    const adapter = createReferenceSandboxAdapter();
    const resolve = vi.fn(async () => 'never');
    const outcome = await resolveGovernanceIntent(
      intent({
        credentials: [
          requirement('wide', true, {
            destinations: [
              { host: 'api.example.test' },
              { host: 'evil.example' },
            ],
          }),
          requirement('port', true, {
            destinations: [{ host: 'api.example.test', port: 8443 }],
          }),
          requirement('mismatch', true),
        ],
      }),
      bindings(adapter, {
        credentials: {
          wide: binding('wide', 'ready', { resolve }),
          port: binding('port', 'ready', {
            destinations: [{ host: 'api.example.test', port: 443 }],
            resolve,
          }),
          mismatch: binding('mismatch', 'ready', { envName: 'OTHER', resolve }),
        },
      }),
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures.map((f) => [f.requirementId, f.code])).toEqual([
      ['wide', 'credential_destination_not_trusted'],
      ['port', 'credential_destination_not_trusted'],
      ['mismatch', 'credential_binding_mismatch'],
    ]);
  });

  it('accepts a requirement narrower than its binding', async () => {
    const adapter = createReferenceSandboxAdapter();
    const outcome = await resolveGovernanceIntent(
      intent({
        credentials: [
          requirement('narrow', true, {
            destinations: [{ host: 'api.example.test', port: 443 }],
          }),
        ],
      }),
      bindings(adapter, { credentials: { narrow: binding('narrow') } }),
    );
    expect(outcome.ok).toBe(true);
  });

  it('keeps absent binding, unavailable provider, inaccessible store, and unknown readiness distinct and reads no value', async () => {
    const adapter = createReferenceSandboxAdapter();
    const resolve = vi.fn(async () => 'never');
    const outcome = await resolveGovernanceIntent(
      intent({
        credentials: [
          requirement('ok'),
          requirement('absent'),
          requirement('provider'),
          requirement('store', false),
          requirement('noprobe'),
        ],
      }),
      bindings(adapter, {
        credentials: {
          ok: binding('ok', 'ready', { resolve }),
          absent: binding('absent', 'binding_absent', { resolve }),
          provider: binding('provider', 'provider_unavailable', { resolve }),
          store: binding('store', 'host_store_inaccessible', { resolve }),
          noprobe: binding('noprobe', 'ready', { probe: undefined, resolve }),
        },
      }),
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(
      outcome.failures.map((f) => [f.requirementId, f.code, f.readiness]),
    ).toEqual([
      ['absent', 'credential_not_ready', 'binding_absent'],
      ['provider', 'credential_not_ready', 'provider_unavailable'],
      ['noprobe', 'credential_not_ready', 'readiness_unknown'],
    ]);
    expect(outcome.failures[0]?.setupInstruction).toBe('fix absent');
    expect(JSON.stringify(outcome)).not.toContain('never');
  });

  it('records provider and readiness for a preferred binding that is not ready, without a resolver', async () => {
    const outcome = await resolveGovernanceIntent(
      intent({ credentials: [requirement('opt', false)] }),
      bindings(createReferenceSandboxAdapter(), {
        credentials: { opt: binding('opt', 'host_store_inaccessible') },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.credentialBindings).toEqual([
      expect.objectContaining({
        requirementId: 'opt',
        provider: 'os-keyring',
        readiness: 'host_store_inaccessible',
      }),
    ]);
    expect(outcome.launchPlan.credentials).toEqual([]);
    expect(outcome.warnings).toContainEqual(
      expect.objectContaining({
        code: 'credential_not_ready',
        readiness: 'host_store_inaccessible',
      }),
    );
  });

  it('stops when a required credential binding or runtime input is missing', async () => {
    const outcome = await resolveGovernanceIntent(
      intent({ credentials: [requirement('api')], runtimeInputs: ['REGION'] }),
      bindings(createReferenceSandboxAdapter()),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures.map((f) => f.code).sort()).toEqual([
      'credential_binding_missing',
      'runtime_input_missing',
    ]);
  });

  it('surfaces adapter preflight failures and retains preflight warnings', async () => {
    const adapter = createReferenceSandboxAdapter();
    const failing: SandboxAdapter = {
      ...adapter,
      preflight: async () => ({
        ok: false,
        issues: [
          { code: 'adapter_unavailable', message: 'daemon not running' },
        ],
      }),
    };
    expect(
      await resolveGovernanceIntent(intent(), bindings(failing)),
    ).toMatchObject({
      ok: false,
      failures: [{ code: 'preflight_failed', message: 'daemon not running' }],
    });
    const warning: SandboxAdapter = {
      ...adapter,
      preflight: async () => ({
        ok: true,
        warnings: [{ code: 'plan_invalid', message: 'legacy image in use' }],
      }),
    };
    const outcome = await resolveGovernanceIntent(intent(), bindings(warning));
    expect(outcome.ok && outcome.warnings).toContainEqual(
      expect.objectContaining({
        code: 'preflight_warning',
        message: 'legacy image in use',
      }),
    );
  });
});

describe('governance session', () => {
  it('seeds declarations, keeps them out of the enforced summary, and binds decisions to the plan', async () => {
    const adapter = createReferenceSandboxAdapter({
      unsupported: ['network-egress'],
    });
    const outcome = await resolveGovernanceIntent(intent(), bindings(adapter));
    if (!outcome.ok) throw new Error('unexpected');
    let tick = 0;
    const session = createGovernanceSession(outcome.plan, {
      id: 'gs-test',
      now: () => new Date(Date.UTC(2026, 7, 21, 0, 0, tick++)),
    });

    const decision = session.recordDecision({
      provider: 'claude',
      toolName: 'bash',
      nativeActionIdentifier: 'toolu_123',
      ...decisionFromGateVerdict({
        allow: false,
        reasonCode: 'tool_not_permitted',
        reason: 'git push',
      }),
      decisionLocus: 'provider-hook',
      intendedEnforcementLocus: 'PreToolUse',
      observedEnforcementLocus: 'PreToolUse',
      enforcementObserved: true,
    });
    const declaredOnly = summarizeEnforcement(session.finish.length ? [] : []);
    expect(declaredOnly.enforced).toEqual([]);
    session.recordEnforcement({
      control: 'host-env-isolation',
      locus: 'guest-sandbox',
      intended: 'none',
      state: 'enforced',
      basis: 'verified',
      reason: 'sentinel absent',
    });
    const lost = session.recordControlLost(
      'filesystem-scope',
      'vfs bridge disconnected',
    );
    session.recordCleanup({ cleaned: true, residue: [] });
    const finished = session.finish('failed');

    expect(decision).toMatchObject({
      runtimeProfileRevision: 3,
      policySnapshotHash: outcome.plan.policySnapshotHash,
      decision: 'deny',
      reasonCode: 'tool_not_permitted',
      decidedAt: '2026-08-21T00:00:01.000Z',
    });
    expect(lost).toBe('failed');
    const summary = summarizeEnforcement(finished.enforcement);
    expect(summary.failed).toEqual(['filesystem-scope@guest-sandbox']);
    expect(summary.enforced).toEqual(['host-env-isolation@guest-sandbox']);
    expect(summary.declaredOnly).toEqual(
      expect.arrayContaining([
        'child-process-containment@guest-sandbox',
        'timeout-cancellation@guest-sandbox',
      ]),
    );
    expect(summary.unsupported).toEqual(
      expect.arrayContaining([
        'network-egress@host-broker',
        'host-exec@outside-containment',
      ]),
    );
    expect(finished.planDigest).toBe(outcome.plan.planDigest);
    expect(finished.outcome).toBe('failed');
    expect(Object.isFrozen(finished.enforcement[0])).toBe(true);
    expect(() => session.recordCleanup({ cleaned: true, residue: [] })).toThrow(
      /already finished/,
    );
  });

  it('reports failed-open when an unrequested but active control disappears', async () => {
    const outcome = await resolveGovernanceIntent(
      intent({ capabilities: {} }),
      bindings(createReferenceSandboxAdapter()),
    );
    if (!outcome.ok) throw new Error('unexpected');
    const session = createGovernanceSession(outcome.plan);
    expect(
      session.recordControlLost('host-env-isolation', 'adapter restarted'),
    ).toBe('failed-open');
    expect(
      summarizeEnforcement(session.finish('completed').enforcement).failedOpen,
    ).toEqual(['host-env-isolation@guest-sandbox']);
  });

  it('maps audit verdicts to audit decisions', () => {
    expect(
      decisionFromGateVerdict({
        reasonCode: 'tool_not_permitted',
        audit: 'would block',
      }),
    ).toEqual({
      decision: 'audit',
      reasonCode: 'tool_not_permitted',
    });
    expect(
      decisionFromGateVerdict({ allow: true, reasonCode: 'policy_allowed' })
        .decision,
    ).toBe('allow');
  });

  it('finds raw value leaks without relying on redaction', () => {
    expect(
      findValueLeaks('s3cr3t', {
        stdout: 'token=s3cr3t',
        session: { ok: true },
      }),
    ).toEqual(['stdout']);
    expect(findValueLeaks('', { stdout: 'anything' })).toEqual([]);
  });
});
