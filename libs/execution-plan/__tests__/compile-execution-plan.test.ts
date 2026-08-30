import { describe, expect, it } from 'vitest';

import {
  compileExecutionPlan,
  credentialAuthorityControl,
  credentialProjectionControl,
  type ExecutionCapabilityOffer,
  type ExecutionIntent,
  hostCapabilityControl,
} from '../src/index.js';

const destination = {
  protocol: 'https' as const,
  host: 'api.example.test',
  port: 443,
};

function intent(overrides: Partial<ExecutionIntent> = {}): ExecutionIntent {
  return {
    mode: 'enforce',
    profile: {
      id: 'profile-a',
      revision: 7,
      definitionCid: 'bafy-profile',
    },
    authority: {
      policySnapshotHash: 'sha256:policy',
      policySnapshotVersion: 'v1',
      authorizedControls: [credentialAuthorityControl('artifact-service')],
    },
    credentialRequirements: [
      {
        name: 'artifact-service',
        kind: 'http-bearer',
        projection: 'brokered-http',
        guestEnv: 'ARTIFACT_TOKEN',
        destinations: [destination],
        required: true,
      },
    ],
    requiredCapabilities: [],
    lease: { ttlSec: 600, requiredControls: [] },
    network: {
      allowedHosts: [destination.host],
      allowedInternalHosts: [],
    },
    ...overrides,
  };
}

function offer(
  overrides: Partial<ExecutionCapabilityOffer> = {},
): ExecutionCapabilityOffer {
  return {
    executor: { id: 'executor-a', fingerprint: 'sha256:executor-a' },
    controls: [
      {
        id: credentialProjectionControl('brokered-http'),
        enforcement: 'native',
        locus: 'isolated-network-boundary',
        constraints: {
          destinations: [destination],
          guestEnvs: ['ARTIFACT_TOKEN'],
        },
      },
    ],
    ...overrides,
  };
}

const ready = [
  {
    name: 'artifact-service',
    required: true,
    status: 'ready' as const,
    bindingDigest: 'sha256:selector',
    source: 'local-activation',
  },
];

describe('compileExecutionPlan', () => {
  it('compiles exact resolved authority into a portable deliverable', () => {
    const plan = compileExecutionPlan({
      intent: intent(),
      offer: offer(),
      credentialReadiness: ready,
    });

    expect(plan).toMatchObject({
      launchable: true,
      executor: { id: 'executor-a', fingerprint: 'sha256:executor-a' },
      deliverables: [
        {
          name: 'artifact-service',
          projection: 'brokered-http',
          guestEnv: 'ARTIFACT_TOKEN',
          destinations: [destination],
          enforcement: 'native',
          locus: 'isolated-network-boundary',
        },
      ],
    });
  });

  it('fails closed when credential authority is unresolved', () => {
    const plan = compileExecutionPlan({
      intent: intent({
        authority: {
          policySnapshotHash: 'sha256:policy',
          policySnapshotVersion: 'v1',
        },
      }),
      offer: offer(),
      credentialReadiness: ready,
    });

    expect(plan.launchable).toBe(false);
    expect(plan.decisions[0]).toMatchObject({
      state: 'failed',
      reason: 'credential_authority_unresolved',
    });
  });

  it('keeps an optional denied requirement degraded and value-free', () => {
    const requirement = {
      ...intent().credentialRequirements[0],
      required: false,
    };
    const plan = compileExecutionPlan({
      intent: intent({
        authority: {
          policySnapshotHash: 'sha256:policy',
          policySnapshotVersion: 'v1',
          authorizedControls: [],
        },
        credentialRequirements: [requirement],
      }),
      offer: offer(),
      credentialReadiness: [{ ...ready[0], required: false }],
    });

    expect(plan.launchable).toBe(true);
    expect(plan.deliverables).toEqual([]);
    expect(plan.decisions[0]).toMatchObject({
      state: 'degraded',
      reason: 'credential_authority_denied',
    });
  });

  it('preserves compensated enforcement from the selected offer', () => {
    const plan = compileExecutionPlan({
      intent: intent(),
      offer: offer({
        controls: [
          {
            ...offer().controls[0],
            enforcement: 'compensated',
            locus: 'trusted-host-compensator',
          },
        ],
      }),
      credentialReadiness: ready,
    });

    expect(plan.decisions[0]).toMatchObject({
      state: 'enforced',
      enforcement: 'compensated',
      locus: 'trusted-host-compensator',
    });
  });

  it('rejects a missing required control offer', () => {
    const plan = compileExecutionPlan({
      intent: intent(),
      offer: offer({ controls: [] }),
      credentialReadiness: ready,
    });

    expect(plan.launchable).toBe(false);
    expect(plan.decisions[0]).toMatchObject({
      state: 'unsupported',
      reason: 'control_not_offered',
    });
  });

  it('preserves exact tuples instead of accepting a widened product', () => {
    const plan = compileExecutionPlan({
      intent: intent(),
      offer: offer({
        controls: [
          {
            ...offer().controls[0],
            constraints: {
              destinations: [
                destination,
                { ...destination, host: 'adjacent.example.test' },
              ],
              guestEnvs: ['ARTIFACT_TOKEN'],
            },
          },
        ],
      }),
      credentialReadiness: ready,
    });

    expect(plan.launchable).toBe(false);
    expect(plan.decisions[0]).toMatchObject({
      reason: 'offer_constraints_mismatch',
    });
  });

  it('requires capability authority and a matching open control offer', () => {
    const capability = hostCapabilityControl('signed-operation');
    const plan = compileExecutionPlan({
      intent: intent({
        authority: {
          ...intent().authority,
          authorizedControls: [
            credentialAuthorityControl('artifact-service'),
            capability,
          ],
        },
        requiredCapabilities: ['signed-operation'],
      }),
      offer: offer({
        controls: [
          ...offer().controls,
          {
            id: capability,
            enforcement: 'native',
            locus: 'trusted-operation-port',
          },
        ],
      }),
      credentialReadiness: ready,
    });

    expect(plan.launchable).toBe(true);
    expect(plan.decisions).toContainEqual(
      expect.objectContaining({
        control: capability,
        enforcement: 'native',
        locus: 'trusted-operation-port',
      }),
    );
  });

  it('rejects duplicate readiness records', () => {
    expect(() =>
      compileExecutionPlan({
        intent: intent(),
        offer: offer(),
        credentialReadiness: [...ready, ...ready],
      }),
    ).toThrow(/duplicate credential readiness/);
  });
});
