import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  assertSecretReferenceBoundTo,
  CredentialResolutionError,
  type MoltNetConfig,
  resolveThroughRegistry,
  type SecretProviderRegistry,
  type SecretReferenceBinding,
  warnLegacyCredentialFieldOnce,
} from '@themoltnet/sdk';

/** Credential kind reported in `CredentialResolutionError.kind`. */
export const GITHUB_APP_PRIVATE_KEY_KIND = 'github-app-private-key';

/** Environment variable the `env` provider may read the PEM from. */
export const GITHUB_APP_PRIVATE_KEY_ENV = 'MOLTNET_GITHUB_APP_PRIVATE_KEY';

/** Canonical provider key for a GitHub App's RSA private key. */
export function githubAppPrivateKeyKey(appId: string): string {
  return `github-app/${appId}/private-key`;
}

/**
 * Binding a `github.private_key_ref` must satisfy: the canonical key, the
 * fixed env variable, or (file provider) the `.`-flattened key.
 */
export function githubAppPrivateKeyBinding(
  appId: string,
): SecretReferenceBinding {
  if (!appId.trim()) {
    throw new Error('credential binding requires github.app_id');
  }
  return {
    canonicalKey: githubAppPrivateKeyKey(appId),
    envKey: GITHUB_APP_PRIVATE_KEY_ENV,
    description:
      'GitHub App private key reference is not bound to this GitHub App',
  };
}

function assertRsaPrivateKeyPem(pem: string): void {
  let type: string | undefined;
  try {
    type = createPrivateKey(pem).asymmetricKeyType;
  } catch {
    throw new CredentialResolutionError(
      GITHUB_APP_PRIVATE_KEY_KIND,
      'invalid_value',
      'value is not a parseable private key PEM',
    );
  }
  if (type !== 'rsa') {
    throw new CredentialResolutionError(
      GITHUB_APP_PRIVATE_KEY_KIND,
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
  const kind = GITHUB_APP_PRIVATE_KEY_KIND;
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
      assertSecretReferenceBoundTo(
        reference,
        githubAppPrivateKeyBinding(github.app_id),
      );
    } catch (cause) {
      throw new CredentialResolutionError(
        kind,
        'unbound',
        (cause as Error).message,
      );
    }
    pem = await resolveThroughRegistry(kind, registry, reference);
  } else if (path) {
    warnLegacyCredentialFieldOnce('github.private_key_path');
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
