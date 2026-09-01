import { describe, expect, it } from 'vitest';

import {
  compileExecutionPlan,
  credentialAuthorityControl,
  type ExecutionIntent,
  explainExecutionPlan,
} from '../src/index.js';

describe('explainExecutionPlan', () => {
  it('reports pins and distinct value-free provenance sources', () => {
    const intent: ExecutionIntent = {
      mode: 'watch',
      profile: { id: 'p', revision: 4, definitionCid: 'bafy-profile' },
      authority: {
        policySnapshotHash: 'sha256:unioned-policy',
        policySnapshotVersion: 'v1',
        authorizedControls: [],
      },
      credentialRequirements: [
        {
          name: 'service',
          kind: 'http-bearer',
          projection: 'host-tool',
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
      provenance: {
        profile: 'resolved-profile',
        policy: 'unioned-policy-snapshot',
        requirements: 'local-watch-fixture',
      },
    };
    const credentialReadiness = [
      {
        name: 'service',
        required: true,
        status: 'ready' as const,
        bindingDigest: 'sha256:selector',
        source: 'local-binding-fixture',
      },
    ];
    const plan = compileExecutionPlan({
      intent,
      offer: { executor: { id: 'e', fingerprint: 'sha256:e' }, controls: [] },
      credentialReadiness,
    });

    const explanation = explainExecutionPlan({
      intent,
      plan,
      credentialReadiness,
    });

    expect(explanation.pins.policySnapshotHash).toBe('sha256:unioned-policy');
    expect(explanation.provenance).toEqual(intent.provenance);
    expect(explanation.requirements[0]).toMatchObject({
      authority: 'denied',
      bindingDigest: 'sha256:selector',
      readinessSource: 'local-binding-fixture',
    });
    expect(explanation.blockingReasons[0]).toContain(
      credentialAuthorityControl('service'),
    );
  });
});
