import type { ExecutionCapabilityOffer } from '@moltnet/execution-plan';
import type { ResolvedRuntimeProfile } from '@themoltnet/agent-runtime';
import {
  READ_ONLY_CAPABILITIES,
  type SecretProvider,
  SecretProviderRegistry,
} from '@themoltnet/sdk';
import { describe, expect, it } from 'vitest';

import {
  loadRuntimeCredentialConfig,
  observeGovernancePlan,
  observeGovernancePlanSafely,
  resolveCredentialEnforcement,
} from './governance-plan.js';

const REQUIREMENTS_JSON = JSON.stringify({
  'profile-1': [
    {
      name: 'github-app',
      kind: 'http-bearer',
      projection: 'brokered-http',
      guestEnv: 'GH_TOKEN',
      destinations: [{ protocol: 'https', host: 'api.github.com', port: 443 }],
    },
  ],
});
const BINDINGS_JSON = JSON.stringify({
  'github-app': { reference: { provider: 'memory', key: 'GH_APP_TOKEN' } },
});

describe('loadRuntimeCredentialConfig', () => {
  it('returns null when neither source is set', () => {
    expect(
      loadRuntimeCredentialConfig({ profileRequirements: '', bindings: '' }),
    ).toBeNull();
  });

  it('keeps requirement and binding provenance distinct', () => {
    const config = loadRuntimeCredentialConfig({
      profileRequirements: REQUIREMENTS_JSON,
      bindings: BINDINGS_JSON,
    });

    expect(config?.requirementsByProfile['profile-1']?.[0]?.name).toBe(
      'github-app',
    );
    expect(config?.bindings['github-app']).toMatchObject({
      reference: { provider: 'memory' },
      source: 'local-bindings-config',
    });
    expect(config?.sources).toEqual({
      requirements: 'profile-requirements-config',
      bindings: 'local-bindings-config',
    });
  });

  it('fails closed when either source is malformed', () => {
    expect(() =>
      loadRuntimeCredentialConfig({
        profileRequirements: '{oops',
        bindings: BINDINGS_JSON,
      }),
    ).toThrow();
    expect(() =>
      loadRuntimeCredentialConfig({
        profileRequirements: REQUIREMENTS_JSON,
        bindings: '{oops',
      }),
    ).toThrow();
  });
});

describe('observeGovernancePlan', () => {
  const config = loadRuntimeCredentialConfig({
    profileRequirements: REQUIREMENTS_JSON,
    bindings: BINDINGS_JSON,
  });
  if (config === null) throw new Error('config fixture must parse');

  const profile = {
    id: 'profile-1',
    definitionCid: 'bafyprofile',
    runtimeKind: 'gondolin_pi',
    leaseTtlSec: 3600,
    sandboxConfig: { network: { allowedHosts: ['api.github.com'] } },
    source: 'runtime-profile:profile-1',
  } as ResolvedRuntimeProfile;
  const offer = offerFixture();
  const registry = registryFixture('synthetic-sentinel');
  const authority = {
    runtimeProfileId: 'profile-1',
    runtimeProfileRevision: 7,
    policySnapshotHash: 'sha256:abc',
    executorFingerprint: 'sha256:executor',
  };
  const correlation = {
    executorFingerprint: 'sha256:executor',
    taskId: 'task-1',
    attemptN: 2,
  };

  it('records unresolved credential authority and remains value-free', async () => {
    const logged: object[] = [];
    const logger = {
      info: (obj: object) => {
        logged.push(obj);
      },
      warn: (obj: object) => {
        logged.push(obj);
      },
    };

    const observed = await observeGovernancePlan({
      config,
      profile,
      offer,
      registry,
      claimAuthority: authority,
      ...correlation,
      logger,
    });

    expect(observed.status).toBe('observed');
    if (observed.status !== 'observed') throw new Error('expected snapshot');
    expect(observed.snapshot.plan).toMatchObject({
      mode: 'watch',
      launchable: false,
    });
    expect(observed.snapshot.plan.decisions[0]).toMatchObject({
      control: 'credential:github-app',
      state: 'failed',
      reason: 'credential_authority_unresolved',
    });
    expect(observed.snapshot.intent.profile.revision).toBe(7);
    expect(observed.snapshot.intent.provenance).toEqual({
      profile: 'runtime-profile:profile-1',
      policy: 'runtime-policy-snapshot:sha256:abc',
      requirements: 'profile-requirements-config',
    });
    const payload = JSON.stringify(logged);
    expect(payload).toContain(observed.snapshot.cid);
    expect(payload).not.toContain('synthetic-sentinel');
    expect(payload).not.toContain('GH_APP_TOKEN');
  });

  it('compiles an empty requirement set for an unlisted profile', async () => {
    const unlistedProfile = {
      ...profile,
      id: 'profile-unlisted',
      source: 'runtime-profile:profile-unlisted',
    };
    const observed = await observeGovernancePlan({
      config,
      profile: unlistedProfile,
      offer,
      registry,
      claimAuthority: {
        ...authority,
        runtimeProfileId: unlistedProfile.id,
      },
      ...correlation,
      logger: { info: () => undefined, warn: () => undefined },
    });

    expect(observed.status).toBe('observed');
    if (observed.status !== 'observed') throw new Error('expected snapshot');
    expect(observed.snapshot.plan.decisions).toEqual([]);
    expect(observed.snapshot.plan.launchable).toBe(true);
  });

  it('represents missing claim authority without minting fake pins', async () => {
    const warnings: { obj: object; msg?: string }[] = [];
    const observed = await observeGovernancePlan({
      config,
      profile,
      offer,
      registry,
      claimAuthority: {},
      ...correlation,
      logger: {
        info: () => undefined,
        warn: (obj: object, msg?: string) => {
          warnings.push({ obj, msg });
        },
      },
    });

    expect(observed).toEqual({
      status: 'unavailable',
      snapshot: null,
      reason: 'claim_authority_unpinned',
    });
    expect(warnings[0]?.obj).toMatchObject({
      taskId: 'task-1',
      attemptN: 2,
      reason: 'claim_authority_unpinned',
    });
  });

  it('refuses claim/profile and executor identity mismatches', async () => {
    const logger = { info: () => undefined, warn: () => undefined };

    await expect(
      observeGovernancePlan({
        config,
        profile,
        offer,
        registry,
        claimAuthority: { ...authority, runtimeProfileId: 'profile-other' },
        ...correlation,
        logger,
      }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'runtime_profile_mismatch',
    });
    await expect(
      observeGovernancePlan({
        config,
        profile,
        offer,
        registry,
        claimAuthority: { ...authority, executorFingerprint: 'sha256:other' },
        ...correlation,
        logger,
      }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'executor_fingerprint_mismatch',
    });
  });

  it('bounds a never-resolving host probe without gating the task', async () => {
    const warnings: { obj: object; msg?: string }[] = [];
    const result = await observeGovernancePlanSafely(
      {
        config,
        profile,
        offer,
        registry: new SecretProviderRegistry().register({
          name: 'memory',
          capabilities: READ_ONLY_CAPABILITIES,
          read: () => Promise.resolve(null),
          probe: () =>
            new Promise(() => {
              // Deliberately unsettled to exercise the observer deadline.
            }),
        }),
        claimAuthority: authority,
        ...correlation,
        logger: {
          info: () => undefined,
          warn: (obj: object, msg?: string) => warnings.push({ obj, msg }),
        },
      },
      5,
    );

    expect(result).toBeNull();
    expect(warnings[0]?.obj).toMatchObject({
      mode: 'observe',
      taskId: 'task-1',
      attemptN: 2,
      err: 'governance observation timed out',
    });
  });
});

describe('resolveCredentialEnforcement', () => {
  const sources = {
    profileRequirements: REQUIREMENTS_JSON,
    bindings: BINDINGS_JSON,
  };
  const empty = { profileRequirements: '', bindings: '' };

  it('defaults to off without configuration and watch with fixtures', () => {
    expect(resolveCredentialEnforcement('', empty)).toBe('off');
    expect(resolveCredentialEnforcement('', sources)).toBe('watch');
  });

  it('honors off and rejects enforce until the cutover', () => {
    expect(resolveCredentialEnforcement('off', sources)).toBe('off');
    expect(() => resolveCredentialEnforcement('enforce', sources)).toThrow(
      /not.*implemented|watch/i,
    );
  });

  it('rejects unknown values', () => {
    expect(() => resolveCredentialEnforcement('observe', sources)).toThrow();
  });
});

function offerFixture(): ExecutionCapabilityOffer {
  return {
    executor: { id: 'runtime-a@1', fingerprint: 'sha256:executor' },
    controls: [
      {
        id: 'credential-projection:brokered-http',
        enforcement: 'native',
        locus: 'selected-runtime',
        constraints: {
          destinations: [
            { protocol: 'https', host: 'api.github.com', port: 443 },
          ],
          guestEnvs: ['GH_TOKEN'],
        },
      },
    ],
  };
}

function registryFixture(value: string): SecretProviderRegistry {
  const provider: SecretProvider = {
    name: 'memory',
    capabilities: READ_ONLY_CAPABILITIES,
    read: (key) => Promise.resolve(key === 'GH_APP_TOKEN' ? value : null),
    probe: (key) =>
      Promise.resolve(key === 'GH_APP_TOKEN' ? 'present' : 'absent'),
  };
  return new SecretProviderRegistry().register(provider);
}
