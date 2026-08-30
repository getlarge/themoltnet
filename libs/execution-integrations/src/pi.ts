import {
  type CredentialDestination,
  credentialProjectionControl,
  type EnforcementKind,
  type ExecutionCapabilityOffer,
  hostCapabilityControl,
} from '@moltnet/execution-plan';
import type { PiExecutorManifest } from '@themoltnet/pi-runtime';

export interface PiOfferOptions {
  executorFingerprint: string;
  enforcement?: EnforcementKind;
  locus?: string;
}

/** Convert the canonical Pi manifest to a portable, open-ended offer. */
export function executionCapabilityOfferFromPiManifest(
  manifest: PiExecutorManifest,
  options: PiOfferOptions,
): ExecutionCapabilityOffer {
  const enforcement = options.enforcement ?? 'native';
  const locus = options.locus ?? 'pi:isolated-runtime';
  return {
    executor: {
      id: `${manifest.runtime.id}@${manifest.runtime.version}`,
      fingerprint: options.executorFingerprint,
    },
    controls: [
      ...(manifest.brokeredHttpSecrets ?? []).map((secret) => ({
        id: credentialProjectionControl('brokered-http'),
        enforcement,
        locus,
        constraints: {
          destinations: manifestDestinations(secret),
          guestEnvs: [secret.guestEnv],
        },
      })),
      ...(manifest.hostCapabilities ?? []).map((capability) => ({
        id: hostCapabilityControl(capability.name),
        enforcement,
        locus,
      })),
    ],
  };
}

function manifestDestinations(
  secret: NonNullable<PiExecutorManifest['brokeredHttpSecrets']>[number],
): CredentialDestination[] {
  return secret.hosts.flatMap((host) =>
    secret.ports.map((port) => ({ protocol: secret.protocol, host, port })),
  );
}
