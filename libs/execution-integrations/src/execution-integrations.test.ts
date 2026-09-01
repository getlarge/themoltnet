import {
  compileExecutionPlan,
  createExecutionPlanSnapshot,
  credentialAuthorityControl,
  credentialProjectionControl,
  type ExecutionIntent,
} from '@moltnet/execution-plan';
import {
  bindExecution,
  createRuntimeExecution,
} from '@moltnet/runtime-execution';
import {
  EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION,
  type EffectivePolicySnapshotV1,
} from '@moltnet/runtime-policy-service';
import type { ResolvedRuntimeProfile } from '@themoltnet/agent-runtime';
import {
  PI_EXECUTOR_MANIFEST_VERSION,
  type PiExecutorManifest,
} from '@themoltnet/pi-runtime';
import {
  READ_ONLY_CAPABILITIES,
  type SecretProvider,
  SecretProviderRegistry,
} from '@themoltnet/sdk';
import { describe, expect, it } from 'vitest';

import {
  checkCredentialReadiness,
  createCredentialDeliveryPort,
} from './credential-broker.js';
import {
  createGondolinExecutionAdapter,
  projectExecutionPlanToGondolin,
} from './gondolin.js';
import { executionCapabilityOfferFromPiManifest } from './pi.js';
import { executionIntentFromRuntimeProfile } from './runtime-profile.js';

const requirement = {
  name: 'service',
  kind: 'http-bearer' as const,
  projection: 'brokered-http' as const,
  guestEnv: 'SERVICE_TOKEN',
  destinations: [
    { protocol: 'https' as const, host: 'api.example.test', port: 443 },
  ],
  required: true,
};

describe('runtime profile integration', () => {
  it('maps already-resolved multi-policy authority without composing it', () => {
    const profile = {
      id: 'profile-a',
      definitionCid: 'bafy-profile',
      runtimeKind: 'runtime-a',
      leaseTtlSec: 300,
      sandboxConfig: {
        network: { allowedHosts: ['api.example.test'] },
      },
      source: 'runtime-profile:profile-a',
    } as ResolvedRuntimeProfile;
    const snapshot: EffectivePolicySnapshotV1 = {
      version: EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION,
      runtimeKind: 'runtime-a',
      enforcement: 'enforce',
      allowedTools: ['from-policy-a', 'from-policy-b'],
      allowedShellCommands: [],
    };

    const intent = executionIntentFromRuntimeProfile({
      mode: 'watch',
      profile,
      profileRevision: 7,
      policy: {
        hash: 'sha256:resolved-union',
        snapshot,
        authorizedControls: [credentialAuthorityControl('service')],
      },
      credentialRequirements: [requirement],
      requirementsProvenance: 'local-watch-fixture',
    });

    expect(intent.authority).toEqual({
      policySnapshotHash: 'sha256:resolved-union',
      policySnapshotVersion: EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION,
      authorizedControls: ['credential:service'],
    });
    expect(JSON.stringify(intent)).not.toContain('policyIds');
  });
});

describe('Pi and Gondolin integrations', () => {
  it('imports the canonical Pi manifest and preserves its exact offer', () => {
    const manifest = manifestFixture();
    const offer = executionCapabilityOfferFromPiManifest(manifest, {
      executorFingerprint: 'sha256:executor',
      enforcement: 'compensated',
    });

    expect(offer.controls[0]).toEqual({
      id: credentialProjectionControl('brokered-http'),
      enforcement: 'compensated',
      locus: 'pi:isolated-runtime',
      constraints: {
        destinations: [
          { protocol: 'https', host: 'api.example.test', port: 443 },
        ],
        guestEnvs: ['SERVICE_TOKEN'],
      },
    });
  });

  it('rejects tuple products that would widen authority', () => {
    const plan = {
      mode: 'enforce' as const,
      launchable: true,
      executor: { id: 'e', fingerprint: 'f' },
      decisions: [],
      deliverables: [
        {
          name: 'service',
          projection: 'brokered-http',
          guestEnv: 'SERVICE_TOKEN',
          required: true,
          destinations: [
            { protocol: 'https' as const, host: 'a.test', port: 443 },
            { protocol: 'https' as const, host: 'b.test', port: 8443 },
          ],
          offerControl: 'credential-projection:brokered-http',
          enforcement: 'native' as const,
          locus: 'isolated',
        },
      ],
      effectiveNetwork: {
        allowedHosts: ['a.test', 'b.test'],
        allowedInternalHosts: [],
      },
    };

    expect(projectExecutionPlanToGondolin(plan)).toEqual({
      rejected: true,
      reasons: ['service: destination_product_unrepresentable'],
    });
  });
});

describe('credential broker integration', () => {
  it('resolves values only inside the Gondolin launch callback', async () => {
    const sentinel = 'do-not-evidence-this-value';
    const providers = new SecretProviderRegistry().register(
      providerFixture(sentinel),
    );
    const bindings = {
      service: {
        reference: { provider: 'memory', key: 'service-key' },
        source: 'local-watch-fixture',
      },
    };
    const readiness = await checkCredentialReadiness(
      [requirement],
      bindings,
      providers,
    );
    const intent: ExecutionIntent = {
      mode: 'enforce',
      profile: { id: 'p', revision: 1, definitionCid: 'bafy-profile' },
      authority: {
        policySnapshotHash: 'sha256:policy',
        policySnapshotVersion: 'effective-policy:v1',
        authorizedControls: [credentialAuthorityControl('service')],
      },
      credentialRequirements: [requirement],
      requiredCapabilities: [],
      lease: { ttlSec: 60, requiredControls: [] },
      network: {
        allowedHosts: ['api.example.test'],
        allowedInternalHosts: [],
      },
    };
    const offer = executionCapabilityOfferFromPiManifest(manifestFixture(), {
      executorFingerprint: 'sha256:executor',
    });
    const plan = compileExecutionPlan({
      intent,
      offer,
      credentialReadiness: readiness,
    });
    const snapshot = await createExecutionPlanSnapshot({
      intent,
      offer,
      credentialReadiness: readiness,
      plan,
    });
    const execution = await createRuntimeExecution(snapshot, {
      executionId: 'execution-a',
    });
    let launchValue = '';
    const adapter = createGondolinExecutionAdapter({
      identity: offer.executor,
      launch(input) {
        launchValue = input.brokeredSecrets?.[0]?.value ?? '';
        return Promise.resolve({ controls: [] });
      },
    });

    const evidence = await bindExecution(
      execution,
      adapter,
      createCredentialDeliveryPort(bindings, providers),
    );

    expect(launchValue).toBe(sentinel);
    expect(readiness[0]).toMatchObject({
      status: 'ready',
      source: 'local-watch-fixture',
    });
    expect(JSON.stringify({ snapshot, evidence, readiness })).not.toContain(
      sentinel,
    );
  });
});

function manifestFixture(): PiExecutorManifest {
  return {
    schemaVersion: PI_EXECUTOR_MANIFEST_VERSION,
    runtime: {
      kind: 'runtime-a',
      engine: 'pi',
      sandbox: 'gondolin',
      id: 'runtime-a',
      version: '1.0.0',
    },
    profile: { id: 'p', definitionCid: 'bafy-profile' },
    vm: {
      templateId: 'template-a',
      templateVersion: '1',
      templateFingerprint: 'sha256:template',
      guestAssetBuildId: 'assets-a',
    },
    brokeredHttpSecrets: [
      {
        id: 'service',
        guestEnv: 'SERVICE_TOKEN',
        hosts: ['api.example.test'],
        protocol: 'https',
        ports: [443],
        required: true,
      },
    ],
    tools: [],
    extensions: [],
    executables: [],
  };
}

function providerFixture(value: string): SecretProvider {
  return {
    name: 'memory',
    capabilities: READ_ONLY_CAPABILITIES,
    read(key) {
      return Promise.resolve(key === 'service-key' ? value : null);
    },
    probe(key) {
      return Promise.resolve(key === 'service-key' ? 'present' : 'absent');
    },
  };
}
