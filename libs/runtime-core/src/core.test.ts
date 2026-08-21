import { describe, expect, it } from 'vitest';

import { createReferenceSandboxAdapter } from './conformance/reference-adapter.js';
import { sha256Digest } from './digest.js';
import {
  assertPortableRuntimeProfile,
  type RuntimeProfile,
  RuntimeProfileValidationError,
} from './profile.js';
import { resolveRuntimeProfile } from './resolved.js';
import type { SandboxAdapter, SandboxLaunchPlan } from './sandbox-adapter.js';
import {
  createRuntimeSession,
  decisionFromGateVerdict,
  findValueLeaks,
  summarizeEnforcement,
} from './session.js';
import { stateForUnavailableControl } from './states.js';

function profile(overrides: Partial<RuntimeProfile> = {}): RuntimeProfile {
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
      network: { allowedHosts: ['api.example.test'], allowedInternalHosts: [] },
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

function bindings(
  adapter: SandboxAdapter,
  extra: Partial<Parameters<typeof resolveRuntimeProfile>[1]> = {},
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

describe('assertPortableRuntimeProfile', () => {
  it('rejects host paths, one-token shell rules, and value-bearing credentials', () => {
    // Arrange
    const bad = profile({
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
        network: { allowedHosts: [], allowedInternalHosts: [] },
      },
      credentials: [
        {
          id: 'gh',
          purpose: 'github',
          consumer: 'guest-process',
          destinationHosts: [],
          delivery: 'brokered-http',
          envName: 'lowercase',
          required: true,
          ...({ value: 'ghp_leak' } as object),
        },
      ],
    });

    // Act / Assert
    expect(() => assertPortableRuntimeProfile(bad)).toThrow(
      RuntimeProfileValidationError,
    );
    try {
      assertPortableRuntimeProfile(bad);
    } catch (error) {
      const issues = (error as RuntimeProfileValidationError).issues;
      expect(issues).toHaveLength(5);
      expect(issues.join('\n')).toContain('host path');
      expect(issues.join('\n')).toContain('value-free');
    }
  });
});

describe('resolveRuntimeProfile', () => {
  it('produces a value-free resolved profile with digests and capability verdicts', async () => {
    // Arrange
    const adapter = createReferenceSandboxAdapter();
    const p = profile({
      credentials: [
        {
          id: 'api',
          purpose: 'call api',
          consumer: 'guest-process',
          destinationHosts: ['api.example.test'],
          delivery: 'brokered-http',
          envName: 'API_TOKEN',
          required: true,
        },
      ],
      runtimeInputs: ['REGION'],
    });

    // Act
    const outcome = await resolveRuntimeProfile(
      p,
      bindings(adapter, {
        credentials: {
          api: {
            requirementId: 'api',
            envName: 'API_TOKEN',
            destinationHosts: ['api.example.test'],
            bindingRef: 'keyring:team/api',
            resolve: async () => 'super-secret-value',
          },
        },
        runtimeInputs: { REGION: 'eu-west-1' },
        contextInputs: {
          'repo-conventions': { revision: 'r7', provenance: 'pack:abc' },
        },
        policySnapshotHash: `sha256:${'a'.repeat(64)}`,
      }),
    );

    // Assert
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { resolved, launchPlan } = outcome;
    expect(resolved.profile).toEqual({
      id: 'p1',
      revision: 3,
      definitionCid: 'bafy-test',
    });
    expect(resolved.policySnapshotHash).toBe(`sha256:${'a'.repeat(64)}`);
    expect(resolved.sandboxAdapter.id).toBe('reference-in-memory');
    expect(
      resolved.capabilities.find((c) => c.capability === 'filesystem-scope'),
    ).toMatchObject({
      requested: 'required',
      declared: 'enforced',
      locus: 'guest-sandbox',
    });
    expect(
      resolved.capabilities.find((c) => c.capability === 'brokered-credential')
        ?.requested,
    ).toBe('required');
    expect(resolved.credentialBindings).toEqual([
      {
        requirementId: 'api',
        envName: 'API_TOKEN',
        destinationHosts: ['api.example.test'],
        bindingRef: 'keyring:team/api',
      },
    ]);
    expect(resolved.contextInputs).toEqual([
      {
        slug: 'repo-conventions',
        binding: 'skill',
        revision: 'r7',
        provenance: 'pack:abc',
      },
    ]);
    expect(resolved.hostPowers).toEqual([
      { power: 'host-exec', locus: 'outside-containment' },
    ]);
    expect(resolved.launchPlanDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(resolved)).not.toContain('super-secret-value');
    expect(JSON.stringify(resolved)).not.toContain('/tmp/does-not-matter');
    expect(JSON.stringify(resolved)).not.toContain('eu-west-1');
    expect(launchPlan.env).toEqual({ REGION: 'eu-west-1' });
    expect(launchPlan.workspace.hostPath).toBe('/tmp/does-not-matter');
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it('yields the same digest on two machines with different host paths', async () => {
    const adapter = createReferenceSandboxAdapter();
    const a = await resolveRuntimeProfile(
      profile(),
      bindings(adapter, { workspace: { hostPath: '/a' } }),
    );
    const b = await resolveRuntimeProfile(
      profile(),
      bindings(adapter, { workspace: { hostPath: '/b' } }),
    );
    expect(
      a.ok &&
        b.ok &&
        a.resolved.launchPlanDigest === b.resolved.launchPlanDigest,
    ).toBe(true);
  });

  it('digests the tool policy when the server hash is absent', async () => {
    const adapter = createReferenceSandboxAdapter();
    const outcome = await resolveRuntimeProfile(profile(), bindings(adapter));
    expect(outcome.ok && outcome.resolved.policySnapshotHash).toBe(
      sha256Digest(profile().toolPolicy),
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
    const outcome = await resolveRuntimeProfile(profile(), bindings(spy));
    expect(outcome).toMatchObject({
      ok: false,
      failures: [
        { code: 'capability_unsupported', capability: 'filesystem-scope' },
      ],
    });
    expect(preflights).toBe(0);
  });

  it('warns instead of failing when a preferred capability is unsupported', async () => {
    const adapter = createReferenceSandboxAdapter({
      unsupported: ['network-egress'],
    });
    const outcome = await resolveRuntimeProfile(profile(), bindings(adapter));
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
      outcome.resolved.capabilities.find(
        (c) => c.capability === 'network-egress',
      )?.declared,
    ).toBe('unsupported');
  });

  it('stops when a required credential binding or runtime input is missing', async () => {
    const adapter = createReferenceSandboxAdapter();
    const outcome = await resolveRuntimeProfile(
      profile({
        credentials: [
          {
            id: 'api',
            purpose: 'call api',
            consumer: 'guest-process',
            destinationHosts: ['api.example.test'],
            delivery: 'brokered-http',
            envName: 'API_TOKEN',
            required: true,
          },
        ],
        runtimeInputs: ['REGION'],
      }),
      bindings(adapter),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures.map((f) => f.code).sort()).toEqual([
      'credential_binding_missing',
      'runtime_input_missing',
    ]);
  });

  it('surfaces adapter preflight failures as resolution failures', async () => {
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
    const outcome = await resolveRuntimeProfile(profile(), bindings(failing));
    expect(outcome).toMatchObject({
      ok: false,
      failures: [{ code: 'preflight_failed', message: 'daemon not running' }],
    });
  });
});

describe('runtime session', () => {
  it('seeds enforcement from the resolved profile and records decisions bound to it', async () => {
    // Arrange
    const adapter = createReferenceSandboxAdapter({
      unsupported: ['network-egress'],
    });
    const outcome = await resolveRuntimeProfile(profile(), bindings(adapter));
    if (!outcome.ok) throw new Error('unexpected');
    let tick = 0;
    const session = createRuntimeSession(outcome.resolved, {
      id: 'rs-test',
      now: () => new Date(Date.UTC(2026, 7, 21, 0, 0, tick++)),
    });

    // Act
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
    const lost = session.recordControlLost(
      'filesystem-scope',
      'vfs bridge disconnected',
    );
    session.recordCleanup({ cleaned: true, residue: [] });
    const finished = session.finish('failed');

    // Assert
    expect(decision).toMatchObject({
      runtimeProfileRevision: 3,
      policySnapshotHash: outcome.resolved.policySnapshotHash,
      decision: 'deny',
      reasonCode: 'tool_not_permitted',
      decidedAt: '2026-08-21T00:00:01.000Z',
    });
    expect(lost).toBe('failed');
    const summary = summarizeEnforcement(finished.enforcement);
    expect(summary.failed).toEqual(['filesystem-scope@guest-sandbox']);
    expect(summary.unsupported).toEqual(
      expect.arrayContaining([
        'network-egress@guest-sandbox',
        'host-exec@outside-containment',
      ]),
    );
    expect(summary.enforced).not.toContain('filesystem-scope@guest-sandbox');
    expect(finished.outcome).toBe('failed');
    expect(finished.cleanup).toEqual({ cleaned: true, residue: [] });
    expect(Object.isFrozen(finished)).toBe(true);
    expect(() => session.recordCleanup({ cleaned: true, residue: [] })).toThrow(
      /already finished/,
    );
  });

  it('reports failed-open when an unrequested but active control disappears', async () => {
    const adapter = createReferenceSandboxAdapter();
    const outcome = await resolveRuntimeProfile(
      profile({ capabilities: {} }),
      bindings(adapter),
    );
    if (!outcome.ok) throw new Error('unexpected');
    const session = createRuntimeSession(outcome.resolved);
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
