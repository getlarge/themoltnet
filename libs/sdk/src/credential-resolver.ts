import { cryptoService } from '@moltnet/crypto-service';

import type { MoltNetConfig } from './credentials.js';
import {
  assertSecretReferenceBinding,
  type CredentialKind,
  type SecretProviderRegistry,
} from './secrets.js';

export type CredentialResolutionCode =
  | 'ambiguous'
  | 'missing'
  | 'unbound'
  | 'invalid_value'
  | 'provider_failure';

/** Classifies a failed credential lookup without carrying the value. */
export class CredentialResolutionError extends Error {
  constructor(
    readonly kind: CredentialKind,
    readonly code: CredentialResolutionCode,
    detail: string,
  ) {
    super(`${kind}: ${detail}`);
    this.name = 'CredentialResolutionError';
  }
}

const LEGACY_FIELDS: Readonly<Record<CredentialKind, string>> = Object.freeze({
  'oauth2-client-secret': 'oauth2.client_secret',
  'identity-seed': 'keys.private_key',
});
const warned = new Set<CredentialKind>();

/** Emit the deprecation warning for a plaintext credential once per process. */
export function warnLegacyCredentialOnce(kind: CredentialKind): void {
  if (warned.has(kind)) return;
  warned.add(kind);
  // eslint-disable-next-line no-console
  console.warn(
    `Warning: plaintext ${LEGACY_FIELDS[kind]} in moltnet.json is deprecated; move it to a secret provider reference (see docs/reference/agent-configuration.md).`,
  );
}

/** Test hook — module-internal, not part of the published SDK surface. */
export function resetLegacyCredentialWarnings(): void {
  warned.clear();
}

/**
 * Resolve through the registry, normalizing any provider failure into a
 * value-free `provider_failure` error. Provider messages are retained only
 * as `cause` so callers decide whether to surface them.
 */
async function resolveThroughRegistry(
  kind: CredentialKind,
  registry: SecretProviderRegistry,
  reference: Parameters<SecretProviderRegistry['resolve']>[0],
): Promise<string> {
  try {
    return await registry.resolve(reference);
  } catch (cause) {
    const error = new CredentialResolutionError(
      kind,
      'provider_failure',
      `secret provider ${JSON.stringify(reference.provider)} could not resolve the reference`,
    );
    error.cause = cause;
    throw error;
  }
}

export async function resolveOAuth2ClientSecret(
  config: Pick<MoltNetConfig, 'identity_id' | 'oauth2'>,
  registry: SecretProviderRegistry,
): Promise<string> {
  const kind: CredentialKind = 'oauth2-client-secret';
  // Client secrets are opaque: trim only to decide presence, never the value.
  const legacy = config.oauth2.client_secret;
  const hasLegacy = Boolean(legacy?.trim());
  const reference = config.oauth2.client_secret_ref;
  if (hasLegacy && reference) {
    throw new CredentialResolutionError(
      kind,
      'ambiguous',
      'config must set exactly one of client_secret or client_secret_ref',
    );
  }
  if (reference) {
    try {
      assertSecretReferenceBinding(kind, reference, {
        identityId: config.identity_id,
        clientId: config.oauth2.client_id,
      });
    } catch (cause) {
      throw new CredentialResolutionError(
        kind,
        'unbound',
        (cause as Error).message,
      );
    }
    return resolveThroughRegistry(kind, registry, reference);
  }
  if (hasLegacy && legacy) {
    warnLegacyCredentialOnce(kind);
    return legacy;
  }
  throw new CredentialResolutionError(
    kind,
    'missing',
    'config must set exactly one of client_secret or client_secret_ref',
  );
}

function stripEd25519Prefix(publicKey: string): string {
  const trimmed = publicKey.trim();
  return trimmed.startsWith('ed25519:')
    ? trimmed.slice('ed25519:'.length)
    : trimmed;
}

async function assertSeedMatchesPublicKey(
  seed: string,
  publicKey: string,
): Promise<void> {
  const bytes = Buffer.from(seed, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== seed) {
    throw new CredentialResolutionError(
      'identity-seed',
      'invalid_value',
      'seed must be a base64-encoded 32-byte Ed25519 seed',
    );
  }
  const derived = stripEd25519Prefix(await cryptoService.derivePublicKey(seed));
  if (derived !== stripEd25519Prefix(publicKey)) {
    throw new CredentialResolutionError(
      'identity-seed',
      'invalid_value',
      'seed does not derive keys.public_key',
    );
  }
}

/**
 * Resolve the agent's Ed25519 seed from `keys.private_key` (legacy, warned
 * once) or `keys.private_key_ref`, verifying the reference is bound to this
 * identity and that the value derives `keys.public_key`.
 */
export async function resolveIdentitySeed(
  config: Pick<MoltNetConfig, 'keys'>,
  registry: SecretProviderRegistry,
): Promise<string> {
  const kind: CredentialKind = 'identity-seed';
  const legacy = config.keys.private_key?.trim();
  const reference = config.keys.private_key_ref;
  if (legacy && reference) {
    throw new CredentialResolutionError(
      kind,
      'ambiguous',
      'config must set exactly one of private_key or private_key_ref',
    );
  }
  let seed: string;
  if (reference) {
    try {
      assertSecretReferenceBinding(kind, reference, {
        fingerprint: config.keys.fingerprint,
      });
    } catch (cause) {
      throw new CredentialResolutionError(
        kind,
        'unbound',
        (cause as Error).message,
      );
    }
    seed = (await resolveThroughRegistry(kind, registry, reference)).trim();
  } else if (legacy) {
    warnLegacyCredentialOnce(kind);
    seed = legacy;
  } else {
    throw new CredentialResolutionError(
      kind,
      'missing',
      'config must set exactly one of private_key or private_key_ref',
    );
  }
  await assertSeedMatchesPublicKey(seed, config.keys.public_key);
  return seed;
}
