import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SecretProviderRegistry, type SecretReference } from '@themoltnet/sdk';

import { startCredentialProviderFixture } from './credential-provider-fixture.js';

/**
 * Candidate vocabulary for an executable spike. It is deliberately local to
 * tools/ and is not a runtime-profile or public SDK schema.
 */
export interface ProbeCredentialRequirement {
  id: string;
  required: true;
  consumer: string;
  constraints: {
    destinations: string[];
    delivery: 'host-brokered-request';
  };
}

/** A trusted deployment binds portable intent to an existing secret reference. */
export interface ProbeLocalCredentialBinding {
  id: string;
  requirementId: string;
  reference: SecretReference;
}

export type ProbeResolutionLocus = 'trusted-host' | 'sandbox-guest';

export type ProbeCredentialReasonCode =
  | 'ready'
  | 'required_binding_missing'
  | 'binding_requirement_mismatch'
  | 'provider_unavailable'
  | 'binding_absent'
  | 'host_store_inaccessible'
  | 'resolution_locus_denied'
  | 'destination_denied'
  | 'delivery_failed';

export interface ProbeCredentialEvidence {
  requirementId: string;
  consumer: string;
  bindingId?: string;
  bindingReferenceDigest?: string;
  provider?: string;
  readiness: 'ready' | 'not-ready';
  reasonCode: ProbeCredentialReasonCode;
  resolutionLocus: ProbeResolutionLocus;
  delivery: 'host-brokered-request';
  destination: string;
  destinationDecision: 'allow' | 'deny' | 'not-evaluated';
  operationStarted: boolean;
  credentialValueRecorded: false;
  setupInstruction?: string;
}

export interface CredentialBoundOperationInput {
  requirement: ProbeCredentialRequirement;
  binding?: ProbeLocalCredentialBinding;
  destination: string;
  resolutionLocus: ProbeResolutionLocus;
  secretProviders: SecretProviderRegistry;
  /**
   * The value is scoped to the trusted-host callback. The callback returns no
   * result, preventing a secret-bearing value from becoming probe evidence.
   */
  useAtHost(input: { destination: string; credential: string }): Promise<void>;
}

function referenceDigest(reference: SecretReference): string {
  return createHash('sha256')
    .update(`${reference.provider}\0${reference.key}`)
    .digest('hex');
}

function baseEvidence(
  input: CredentialBoundOperationInput,
): ProbeCredentialEvidence {
  return {
    requirementId: input.requirement.id,
    consumer: input.requirement.consumer,
    readiness: 'not-ready',
    reasonCode: 'required_binding_missing',
    resolutionLocus: input.resolutionLocus,
    delivery: input.requirement.constraints.delivery,
    destination: input.destination,
    destinationDecision: 'not-evaluated',
    operationStarted: false,
    credentialValueRecorded: false,
  };
}

function withBindingEvidence(
  evidence: ProbeCredentialEvidence,
  binding: ProbeLocalCredentialBinding,
): ProbeCredentialEvidence {
  return {
    ...evidence,
    bindingId: binding.id,
    bindingReferenceDigest: referenceDigest(binding.reference),
    provider: binding.reference.provider,
  };
}

function notReady(
  evidence: ProbeCredentialEvidence,
  reasonCode: Exclude<ProbeCredentialReasonCode, 'ready'>,
  setupInstruction: string,
  destinationDecision: ProbeCredentialEvidence['destinationDecision'] = 'not-evaluated',
): ProbeCredentialEvidence {
  return {
    ...evidence,
    readiness: 'not-ready',
    reasonCode,
    destinationDecision,
    setupInstruction,
  };
}

/**
 * Offline safe-launch vertical slice:
 * requirement -> trusted binding -> policy/locus checks -> host resolution ->
 * exact host-side use -> value-free evidence.
 */
export async function runCredentialBoundOperation(
  input: CredentialBoundOperationInput,
): Promise<ProbeCredentialEvidence> {
  let evidence = baseEvidence(input);
  const binding = input.binding;
  if (!binding) {
    return notReady(
      evidence,
      'required_binding_missing',
      `Configure a trusted local binding for required credential "${input.requirement.id}" before launch.`,
    );
  }

  evidence = withBindingEvidence(evidence, binding);
  if (binding.requirementId !== input.requirement.id) {
    return notReady(
      evidence,
      'binding_requirement_mismatch',
      `Bind "${binding.id}" to requirement "${input.requirement.id}" before launch.`,
    );
  }

  if (input.resolutionLocus !== 'trusted-host') {
    return notReady(
      evidence,
      'resolution_locus_denied',
      `Resolve requirement "${input.requirement.id}" at an approved host boundary; do not read its provider from the sandbox guest.`,
    );
  }

  if (!input.requirement.constraints.destinations.includes(input.destination)) {
    return notReady(
      evidence,
      'destination_denied',
      `Use requirement "${input.requirement.id}" only with one of its declared destinations.`,
      'deny',
    );
  }

  evidence = { ...evidence, destinationDecision: 'allow' };
  const provider = input.secretProviders.get(binding.reference.provider);
  if (!provider) {
    return notReady(
      evidence,
      'provider_unavailable',
      `Install or configure secret provider "${binding.reference.provider}" on the trusted host, then rerun preflight.`,
      'allow',
    );
  }

  let credential: string | null;
  try {
    credential = await provider.read(binding.reference.key);
  } catch {
    return notReady(
      evidence,
      'host_store_inaccessible',
      `Make secret provider "${binding.reference.provider}" accessible at the trusted host boundary, then rerun preflight.`,
      'allow',
    );
  }
  if (!credential) {
    return notReady(
      evidence,
      'binding_absent',
      `Store a value for local binding "${binding.id}" in provider "${binding.reference.provider}", then rerun preflight.`,
      'allow',
    );
  }

  try {
    await input.useAtHost({ destination: input.destination, credential });
  } catch {
    return {
      ...notReady(
        evidence,
        'delivery_failed',
        `Check the host delivery adapter for destination "${input.destination}" before launch.`,
        'allow',
      ),
      operationStarted: true,
    };
  } finally {
    credential = null;
  }

  return {
    ...evidence,
    readiness: 'ready',
    reasonCode: 'ready',
    destinationDecision: 'allow',
    operationStarted: true,
  };
}

interface PocFixture {
  notice: string;
  requirement: ProbeCredentialRequirement;
  localBinding: ProbeLocalCredentialBinding;
}

const sourceDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(sourceDir, '../../..');
const fixturePath = join(
  workspaceRoot,
  'tools/test-fixtures/execution-governance/credential-safe-launch-poc.json',
);

async function main(): Promise<void> {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as PocFixture;
  const syntheticCredential = `MOLTNET_SAFE_LAUNCH_${crypto.randomUUID()}`;
  const providerFixture =
    await startCredentialProviderFixture(syntheticCredential);
  const secretProviders = new SecretProviderRegistry().register({
    name: fixture.localBinding.reference.provider,
    read: async (key) =>
      key === fixture.localBinding.reference.key ? syntheticCredential : null,
  });

  try {
    const missingBinding = await runCredentialBoundOperation({
      requirement: fixture.requirement,
      destination: 'fixture.allowed',
      resolutionLocus: 'trusted-host',
      secretProviders,
      useAtHost: async () => {
        throw new Error('missing binding must not start the operation');
      },
    });
    const allowedDestination = await runCredentialBoundOperation({
      requirement: fixture.requirement,
      binding: fixture.localBinding,
      destination: 'fixture.allowed',
      resolutionLocus: 'trusted-host',
      secretProviders,
      useAtHost: async ({ credential }) => {
        const response = await fetch(
          `http://127.0.0.1:${providerFixture.port}/safe-launch-poc`,
          { headers: { authorization: `Bearer ${credential}` } },
        );
        if (!response.ok) throw new Error('fixture rejected request');
      },
    });
    const requestsAfterAllowed = providerFixture.requests.length;
    const wrongDestination = await runCredentialBoundOperation({
      requirement: fixture.requirement,
      binding: fixture.localBinding,
      destination: 'fixture.denied',
      resolutionLocus: 'trusted-host',
      secretProviders,
      useAtHost: async () => {
        throw new Error('denied destination must not start the operation');
      },
    });
    const output = {
      notice: fixture.notice,
      scenarios: {
        missingBinding,
        allowedDestination,
        wrongDestination,
      },
      hostFixture: {
        allowedRequestAuthenticated:
          providerFixture.requests[0]?.credentialMatched === true,
        wrongDestinationRequestCount:
          providerFixture.requests.length - requestsAfterAllowed,
      },
    };
    const serialized = JSON.stringify(output, null, 2);
    if (serialized.includes(syntheticCredential)) {
      throw new Error('synthetic credential appeared in PoC evidence');
    }
    process.stdout.write(`${serialized}\n`);
  } finally {
    await providerFixture.close();
  }
}

if (
  process.argv[1] &&
  basename(process.argv[1]).startsWith('credential-safe-launch-poc')
) {
  main().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
