import { describe, expect, it } from 'vitest';

import {
  compileExecutionPlan,
  createExecutionPlanSnapshot,
  credentialAuthorityControl,
  credentialProjectionControl,
  type ExecutionIntent,
  verifyExecutionPlanSnapshot,
} from '../src/index.js';

const intent: ExecutionIntent = {
  mode: 'enforce',
  profile: { id: 'p', revision: 2, definitionCid: 'bafy-profile' },
  authority: {
    policySnapshotHash: 'sha256:policy',
    policySnapshotVersion: 'v1',
    authorizedControls: [credentialAuthorityControl('service')],
  },
  credentialRequirements: [
    {
      name: 'service',
      kind: 'http-bearer',
      projection: 'brokered-http',
      guestEnv: 'SERVICE_TOKEN',
      destinations: [
        { protocol: 'https', host: 'service.example.test', port: 443 },
      ],
      required: true,
    },
  ],
  requiredCapabilities: [],
  lease: { ttlSec: 60, requiredControls: [] },
  network: {
    allowedHosts: ['service.example.test'],
    allowedInternalHosts: [],
  },
};
const offer = {
  executor: { id: 'e', fingerprint: 'sha256:e' },
  controls: [
    {
      id: credentialProjectionControl('brokered-http'),
      enforcement: 'native' as const,
      locus: 'boundary',
      constraints: {
        destinations: intent.credentialRequirements[0].destinations,
        guestEnvs: ['SERVICE_TOKEN'],
      },
    },
  ],
};
const credentialReadiness = [
  {
    name: 'service',
    required: true,
    status: 'ready' as const,
    bindingDigest: 'sha256:selector',
  },
];

describe('execution plan snapshot', () => {
  it('pins intent, offer, readiness, and plan in a deterministic CID', async () => {
    const plan = compileExecutionPlan({ intent, offer, credentialReadiness });

    const first = await createExecutionPlanSnapshot({
      intent,
      offer,
      credentialReadiness,
      plan,
    });
    const second = await createExecutionPlanSnapshot({
      intent,
      offer,
      credentialReadiness,
      plan,
    });

    expect(first.cid).toBe(second.cid);
    expect(await verifyExecutionPlanSnapshot(first)).toBe(true);
    expect(Object.isFrozen(first.plan.deliverables[0].destinations)).toBe(true);
  });

  it('detects tampering and contains no credential values', async () => {
    const plan = compileExecutionPlan({ intent, offer, credentialReadiness });
    const snapshot = await createExecutionPlanSnapshot({
      intent,
      offer,
      credentialReadiness,
      plan,
    });
    const tampered = structuredClone(snapshot);
    tampered.intent.profile.revision = 3;

    expect(await verifyExecutionPlanSnapshot(tampered)).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('sentinel-secret-value');
  });
});
