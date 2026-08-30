import {
  compileExecutionPlan,
  createExecutionPlanSnapshot,
  credentialAuthorityControl,
  credentialProjectionControl,
  type ExecutionIntent,
} from '@moltnet/execution-plan';
import { describe, expect, it, vi } from 'vitest';

import {
  bindExecution,
  createRuntimeExecution,
  type ExecutionAdapter,
} from './runtime-execution.js';

async function fixture(mode: 'watch' | 'enforce' = 'enforce') {
  const intent: ExecutionIntent = {
    mode,
    profile: { id: 'p', revision: 1, definitionCid: 'bafy-profile' },
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
    executor: { id: 'executor-a', fingerprint: 'sha256:executor-a' },
    controls: [
      {
        id: credentialProjectionControl('brokered-http'),
        enforcement: 'native' as const,
        locus: 'isolated-boundary',
        constraints: {
          destinations: intent.credentialRequirements[0].destinations,
          guestEnvs: ['SERVICE_TOKEN'],
        },
      },
    ],
  };
  const credentialReadiness = [
    { name: 'service', required: true, status: 'ready' as const },
  ];
  const plan = compileExecutionPlan({ intent, offer, credentialReadiness });
  return createExecutionPlanSnapshot({
    intent,
    offer,
    credentialReadiness,
    plan,
  });
}

describe('runtime execution', () => {
  it('rejects watch-only snapshots', async () => {
    await expect(
      createRuntimeExecution(await fixture('watch'), { executionId: 'x' }),
    ).rejects.toThrow(/watch-only/);
  });

  it('rejects an adapter identity mismatch before delivery', async () => {
    const execution = await createRuntimeExecution(await fixture(), {
      executionId: 'x',
    });
    const withCredential = vi.fn();

    await expect(
      bindExecution(
        execution,
        {
          name: 'adapter-a',
          identity: { id: 'other', fingerprint: 'sha256:other' },
          launch: () => Promise.resolve({ controls: [] }),
        },
        { withCredential },
      ),
    ).rejects.toThrow(/does not match/);
    expect(withCredential).not.toHaveBeenCalled();
  });

  it('scopes the value and emits only a value-free receipt', async () => {
    const execution = await createRuntimeExecution(await fixture(), {
      executionId: 'x',
      startsAt: new Date('2026-01-01T00:00:00Z'),
    });
    let observed = '';
    const adapter: ExecutionAdapter = {
      name: 'adapter-a',
      identity: { id: 'executor-a', fingerprint: 'sha256:executor-a' },
      async launch(request) {
        await request.deliverCredential('service', (value) => {
          observed = value;
        });
        return { controls: [] };
      },
    };

    const evidence = await bindExecution(
      execution,
      adapter,
      {
        async withCredential(name, use) {
          await use('sentinel-secret-value');
          return {
            name,
            bindingDigest: 'sha256:0123456789abcdef',
            source: 'local-activation',
          };
        },
      },
      { now: new Date('2026-01-01T00:00:10Z') },
    );

    expect(observed).toBe('sentinel-secret-value');
    expect(evidence[0]).toMatchObject({
      control: 'credential:service',
      bindingDigest: 'sha256:0123456789abcdef',
      bindingSource: 'local-activation',
    });
    expect(JSON.stringify(evidence)).not.toContain('sentinel-secret-value');
  });

  it('rejects delivery outside compiled deliverables', async () => {
    const execution = await createRuntimeExecution(await fixture(), {
      executionId: 'x',
    });
    await expect(
      bindExecution(
        execution,
        {
          name: 'adapter-a',
          identity: { id: 'executor-a', fingerprint: 'sha256:executor-a' },
          async launch(request) {
            await request.deliverCredential('other', () => undefined);
            return { controls: [] };
          },
        },
        {
          withCredential: () =>
            Promise.resolve({
              name: 'other',
              bindingDigest: 'sha256:0123456789abcdef',
            }),
        },
      ),
    ).rejects.toThrow(/not authorized/);
  });

  it('rejects value-bearing receipt and adapter evidence metadata', async () => {
    const execution = await createRuntimeExecution(await fixture(), {
      executionId: 'x',
    });
    const adapter: ExecutionAdapter = {
      name: 'adapter-a',
      identity: { id: 'executor-a', fingerprint: 'sha256:executor-a' },
      async launch(request) {
        await request.deliverCredential('service', () => undefined);
        return { controls: [] };
      },
    };

    await expect(
      bindExecution(execution, adapter, {
        async withCredential(name, use) {
          await use('scoped-value');
          return {
            name,
            bindingDigest: 'sha256:0123456789abcdef',
            source: 'value must not be evidence',
          };
        },
      }),
    ).rejects.toThrow(/receipt source is invalid/);
  });
});
