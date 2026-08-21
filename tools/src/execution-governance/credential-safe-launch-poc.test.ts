import { SecretProviderRegistry } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  type ProbeCredentialRequirement,
  type ProbeLocalCredentialBinding,
  runCredentialBoundOperation,
} from './credential-safe-launch-poc.js';

const requirement: ProbeCredentialRequirement = {
  id: 'source-control.write',
  required: true,
  consumer: 'host-source-control-client',
  constraints: {
    destinations: ['source-control.example'],
    delivery: 'host-brokered-request',
  },
};

const binding: ProbeLocalCredentialBinding = {
  id: 'local-source-control',
  requirementId: requirement.id,
  reference: { provider: 'synthetic-host-store', key: 'fixture/token' },
};

function registryWith(
  read: (key: string) => Promise<string | null>,
): SecretProviderRegistry {
  return new SecretProviderRegistry().register({
    name: binding.reference.provider,
    read,
  });
}

describe('credential safe-launch PoC', () => {
  it('stops before launch when a required local binding is missing', async () => {
    const read = vi.fn();
    const useAtHost = vi.fn();

    const evidence = await runCredentialBoundOperation({
      requirement,
      destination: 'source-control.example',
      resolutionLocus: 'trusted-host',
      secretProviders: registryWith(read),
      useAtHost,
    });

    expect(evidence).toMatchObject({
      readiness: 'not-ready',
      reasonCode: 'required_binding_missing',
      operationStarted: false,
      credentialValueRecorded: false,
    });
    expect(evidence.setupInstruction).toContain(requirement.id);
    expect(read).not.toHaveBeenCalled();
    expect(useAtHost).not.toHaveBeenCalled();
  });

  it('uses the value only inside the allowed host operation and returns value-free evidence', async () => {
    const credential = 'MOLTNET_SAFE_LAUNCH_SYNTHETIC_TEST';
    const read = vi.fn(async () => credential);
    const useAtHost = vi.fn(async ({ credential: received }) => {
      expect(received).toBe(credential);
    });

    const evidence = await runCredentialBoundOperation({
      requirement,
      binding,
      destination: 'source-control.example',
      resolutionLocus: 'trusted-host',
      secretProviders: registryWith(read),
      useAtHost,
    });

    expect(evidence).toMatchObject({
      readiness: 'ready',
      reasonCode: 'ready',
      destinationDecision: 'allow',
      operationStarted: true,
      credentialValueRecorded: false,
      provider: 'synthetic-host-store',
    });
    expect(evidence.bindingReferenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(evidence)).not.toContain(credential);
    expect(JSON.stringify(evidence)).not.toContain(binding.reference.key);
    expect(useAtHost).toHaveBeenCalledOnce();
  });

  it('denies a wrong destination before reading the credential', async () => {
    const read = vi.fn(async () => 'must-not-be-read');
    const useAtHost = vi.fn();

    const evidence = await runCredentialBoundOperation({
      requirement,
      binding,
      destination: 'sibling.example',
      resolutionLocus: 'trusted-host',
      secretProviders: registryWith(read),
      useAtHost,
    });

    expect(evidence).toMatchObject({
      readiness: 'not-ready',
      reasonCode: 'destination_denied',
      destinationDecision: 'deny',
      operationStarted: false,
    });
    expect(read).not.toHaveBeenCalled();
    expect(useAtHost).not.toHaveBeenCalled();
  });

  it('denies guest-side resolution before touching the host provider', async () => {
    const read = vi.fn(async () => 'must-not-be-read');
    const useAtHost = vi.fn();

    const evidence = await runCredentialBoundOperation({
      requirement,
      binding,
      destination: 'source-control.example',
      resolutionLocus: 'sandbox-guest',
      secretProviders: registryWith(read),
      useAtHost,
    });

    expect(evidence.reasonCode).toBe('resolution_locus_denied');
    expect(evidence.operationStarted).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(useAtHost).not.toHaveBeenCalled();
  });

  it('distinguishes an absent value from an inaccessible host store', async () => {
    const useAtHost = vi.fn();
    const absent = await runCredentialBoundOperation({
      requirement,
      binding,
      destination: 'source-control.example',
      resolutionLocus: 'trusted-host',
      secretProviders: registryWith(async () => null),
      useAtHost,
    });
    const inaccessible = await runCredentialBoundOperation({
      requirement,
      binding,
      destination: 'source-control.example',
      resolutionLocus: 'trusted-host',
      secretProviders: registryWith(async () => {
        throw new Error('host keyring denied access');
      }),
      useAtHost,
    });

    expect(absent.reasonCode).toBe('binding_absent');
    expect(inaccessible.reasonCode).toBe('host_store_inaccessible');
    expect(absent.setupInstruction).not.toBe(inaccessible.setupInstruction);
    expect(useAtHost).not.toHaveBeenCalled();
  });

  it('reports an unavailable provider without exposing its key', async () => {
    const useAtHost = vi.fn();

    const evidence = await runCredentialBoundOperation({
      requirement,
      binding,
      destination: 'source-control.example',
      resolutionLocus: 'trusted-host',
      secretProviders: new SecretProviderRegistry(),
      useAtHost,
    });

    expect(evidence.reasonCode).toBe('provider_unavailable');
    expect(JSON.stringify(evidence)).not.toContain(binding.reference.key);
    expect(useAtHost).not.toHaveBeenCalled();
  });
});
