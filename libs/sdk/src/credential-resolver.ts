import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { cryptoService } from '@moltnet/crypto-service';

import type { MoltNetConfig } from './credentials.js';
import {
  assertSecretReferenceBinding,
  type CredentialKind,
  parseSecretReferenceString,
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
  'github-app-private-key': 'github.private_key_path',
  'agent-key': 'agent_key',
});
const warned = new Set<CredentialKind>();

/** Emit the deprecation warning for a plaintext credential once per process. */
export function warnLegacyCredentialOnce(kind: CredentialKind): void {
  if (warned.has(kind)) return;
  warned.add(kind);
  // eslint-disable-next-line no-console
  console.warn(
    `Warning: plaintext ${LEGACY_FIELDS[kind]} in moltnet.json is deprecated; run 'moltnet config migrate' to move it to a secret provider reference (see docs/reference/agent-configuration.md).`,
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

function assertRsaPrivateKeyPem(pem: string): void {
  let type: string | undefined;
  try {
    type = createPrivateKey(pem).asymmetricKeyType;
  } catch {
    throw new CredentialResolutionError(
      'github-app-private-key',
      'invalid_value',
      'value is not a parseable private key PEM',
    );
  }
  if (type !== 'rsa') {
    throw new CredentialResolutionError(
      'github-app-private-key',
      'invalid_value',
      `expected an RSA private key, got ${type ?? 'unknown'}`,
    );
  }
}

/**
 * Resolve the GitHub App private key PEM from `github.private_key_path`
 * (legacy file, warned once) or `github.private_key_ref`, verifying the
 * reference is bound to this App and the value parses as an RSA key.
 */
export async function resolveGitHubAppPrivateKey(
  config: Pick<MoltNetConfig, 'github'>,
  registry: SecretProviderRegistry,
): Promise<string> {
  const kind: CredentialKind = 'github-app-private-key';
  const github = config.github;
  if (!github) {
    throw new CredentialResolutionError(
      kind,
      'missing',
      'GitHub App not configured — add a github section to moltnet.json',
    );
  }
  const path = github.private_key_path?.trim();
  const reference = github.private_key_ref;
  if (path && reference) {
    throw new CredentialResolutionError(
      kind,
      'ambiguous',
      'config must set exactly one of github.private_key_path or github.private_key_ref',
    );
  }
  let pem: string;
  if (reference) {
    try {
      assertSecretReferenceBinding(kind, reference, { appId: github.app_id });
    } catch (cause) {
      throw new CredentialResolutionError(
        kind,
        'unbound',
        (cause as Error).message,
      );
    }
    pem = await registry.resolve(reference);
  } else if (path) {
    warnLegacyCredentialOnce(kind);
    pem = await readFile(path, 'utf8');
  } else {
    throw new CredentialResolutionError(
      kind,
      'missing',
      'config must set exactly one of github.private_key_path or github.private_key_ref',
    );
  }
  assertRsaPrivateKeyPem(pem);
  return pem;
}

/**
 * Resolve a team-bound agent key from `agent_key_ref`. Returns `null` when
 * the config has no reference (callers then fall back to OAuth2).
 */
export async function resolveAgentKey(
  config: Pick<MoltNetConfig, 'identity_id' | 'agent_key_ref'>,
  registry: SecretProviderRegistry,
): Promise<string | null> {
  const kind: CredentialKind = 'agent-key';
  const reference = config.agent_key_ref;
  if (!reference) return null;
  try {
    assertSecretReferenceBinding(kind, reference, {
      identityId: config.identity_id,
    });
  } catch (cause) {
    throw new CredentialResolutionError(
      kind,
      'unbound',
      (cause as Error).message,
    );
  }
  const value = (
    await resolveThroughRegistry(kind, registry, reference)
  ).trim();
  if (!value) {
    throw new CredentialResolutionError(
      kind,
      'invalid_value',
      'agent key is empty',
    );
  }
  return value;
}

/**
 * Resolve an environment-supplied `<provider>:<key>` reference. The runtime
 * environment is deployer-controlled, so — unlike references in
 * `moltnet.json` — no identity binding is enforced; only the shape is.
 */
export async function resolveEnvSecretReference(
  raw: string,
  registry: SecretProviderRegistry,
): Promise<string> {
  const reference = parseSecretReferenceString(raw);
  let value: string;
  try {
    value = (await registry.resolve(reference)).trim();
  } catch (cause) {
    // Value-free: name the reference, keep the provider's message as cause.
    throw new Error(
      `Secret provider ${JSON.stringify(reference.provider)} could not resolve ${reference.provider}:${reference.key}`,
      { cause },
    );
  }
  if (!value) {
    throw new Error(
      `Secret reference ${reference.provider}:${reference.key} resolved to an empty value`,
    );
  }
  return value;
}
