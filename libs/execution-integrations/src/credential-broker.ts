import type { SecretReference } from '@moltnet/agent-config';
import type {
  CredentialReadinessRecord,
  CredentialRequirement,
} from '@moltnet/execution-plan';
import type {
  CredentialBindingReceipt,
  CredentialDeliveryPort,
} from '@moltnet/runtime-execution';
import type { SecretProviderRegistry } from '@themoltnet/sdk';

export type { SecretReference } from '@moltnet/agent-config';

export interface CredentialBinding {
  reference: SecretReference;
  mint?: 'static' | 'github-app-installation';
  source?: string;
}

export async function checkCredentialReadiness(
  requirements: readonly CredentialRequirement[],
  bindings: Readonly<Record<string, CredentialBinding>>,
  providers: SecretProviderRegistry,
): Promise<CredentialReadinessRecord[]> {
  const records: CredentialReadinessRecord[] = [];
  for (const requirement of requirements) {
    const binding = ownBinding(bindings, requirement.name);
    if (binding === undefined) {
      records.push({
        name: requirement.name,
        required: requirement.required,
        status: requirement.required
          ? 'required_binding_missing'
          : 'binding_absent',
      });
      continue;
    }
    const bindingDigest = await digestBindingReference(binding.reference);
    const source = binding.source ?? 'local-activation';
    if (providers.get(binding.reference.provider) === undefined) {
      records.push({
        name: requirement.name,
        required: requirement.required,
        status: 'provider_unavailable',
        bindingDigest,
        source,
      });
      continue;
    }
    const probe = await providers.probe(binding.reference);
    records.push({
      name: requirement.name,
      required: requirement.required,
      status:
        probe === 'present'
          ? 'ready'
          : probe === 'absent'
            ? 'binding_absent'
            : 'host_store_inaccessible',
      bindingDigest,
      source,
    });
  }
  return records;
}

/** Host-only resolution; the value is exposed only inside the scoped sink. */
export function createCredentialDeliveryPort(
  bindings: Readonly<Record<string, CredentialBinding>>,
  providers: SecretProviderRegistry,
): CredentialDeliveryPort {
  return {
    async withCredential(name, use): Promise<CredentialBindingReceipt> {
      const binding = ownBinding(bindings, name);
      if (binding === undefined) {
        throw new Error(`credential "${name}" has no local binding`);
      }
      if (binding.mint !== undefined && binding.mint !== 'static') {
        throw new Error(`credential "${name}" mint strategy is unavailable`);
      }
      if (providers.get(binding.reference.provider) === undefined) {
        throw new Error(`credential "${name}" provider is unavailable`);
      }
      let value: string;
      try {
        value = await providers.resolve(binding.reference);
      } catch {
        throw new Error(`credential "${name}" value is unavailable`);
      }
      await use(value);
      return {
        name,
        bindingDigest: await digestBindingReference(binding.reference),
        source: binding.source ?? 'local-activation',
      };
    },
  };
}

export async function digestBindingReference(
  reference: SecretReference,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${reference.provider}\u0000${reference.key}`,
  );
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex.slice(0, 16)}`;
}

function ownBinding(
  bindings: Readonly<Record<string, CredentialBinding>>,
  name: string,
): CredentialBinding | undefined {
  return Object.hasOwn(bindings, name) ? bindings[name] : undefined;
}
