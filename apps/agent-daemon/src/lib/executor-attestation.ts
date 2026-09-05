import { cryptoService } from '@moltnet/crypto-service';
import { AGENT_CREDENTIAL_SCOPES, CREDENTIAL_SCOPES } from '@moltnet/models';
import {
  createExecutorAttestor,
  type ExecutorAttestor,
  readConfig,
  resolveEnvSecretReference,
  resolveIdentitySeed,
  type Whoami,
} from '@themoltnet/sdk';
import { createNodeSecretProviderRegistry } from '@themoltnet/sdk/node';

import type { PreparedDaemonRuntime } from '../runtime.js';
import type { DaemonAuthMode } from './agent-context.js';
import { logDaemonStartupWarning } from './logger.js';

export const DAEMON_REQUIRED_SCOPES = AGENT_CREDENTIAL_SCOPES;

/**
 * Needed by host-capability signing, which runs on the daemon's own
 * credential: `createLocalSeedSigner` calls `crypto.signingRequests`
 * get/submit, and both routes require `crypto:sign`.
 *
 * Not in {@link DAEMON_REQUIRED_SCOPES}: the signer is wired unconditionally,
 * but whether guest code may actually invoke it is a per-task runtime policy
 * decision (`capability:agent-signing`). A worker whose policy never grants it
 * runs fine without this scope, so a missing `crypto:sign` is a warning rather
 * than a startup failure.
 */
export const DAEMON_SIGNING_SCOPE = CREDENTIAL_SCOPES.CryptoSign;

export interface AttestedDaemonRuntime extends PreparedDaemonRuntime {
  readonly attestor: ExecutorAttestor;
}

export async function resolveExecutorSigningPrivateKey(input: {
  authMode: DaemonAuthMode;
  agentDir: string;
  configuredPrivateKey: string;
  /** `<provider>:<key>` from MOLTNET_PRIVATE_KEY_REF; empty when unset. */
  configuredPrivateKeyRef?: string;
}): Promise<string> {
  if (input.authMode === 'agent-key') {
    const privateKey = input.configuredPrivateKey.trim();
    if (privateKey) return privateKey;
    const reference = input.configuredPrivateKeyRef?.trim();
    if (!reference) {
      throw new Error(
        'Agent-key daemon startup requires MOLTNET_PRIVATE_KEY (or MOLTNET_PRIVATE_KEY_REF) containing the base64-encoded Ed25519 private key seed.',
      );
    }
    let resolved: string;
    try {
      resolved = await resolveEnvSecretReference(
        reference,
        createNodeSecretProviderRegistry(),
      );
    } catch (cause) {
      throw new Error(
        `Agent-key daemon startup could not resolve MOLTNET_PRIVATE_KEY_REF: ${(cause as Error).message}`,
        { cause },
      );
    }
    if (Buffer.from(resolved, 'base64').length !== 32) {
      throw new Error(
        'MOLTNET_PRIVATE_KEY_REF must resolve to a base64-encoded 32-byte Ed25519 seed.',
      );
    }
    return resolved;
  }

  const config = await readConfig(input.agentDir);
  if (!config) {
    throw new Error(
      `OAuth2 daemon startup requires ${input.agentDir}/moltnet.json.`,
    );
  }
  try {
    return await resolveIdentitySeed(
      config,
      createNodeSecretProviderRegistry(),
    );
  } catch (cause) {
    throw new Error(
      `OAuth2 daemon startup could not resolve the signing seed from ${input.agentDir}/moltnet.json (keys.private_key or keys.private_key_ref): ${(cause as Error).message}`,
      { cause },
    );
  }
}

export function validateDaemonScopes(
  whoami: Whoami,
  onWarn?: (message: string) => void,
): void {
  const available = new Set(whoami.scopes ?? []);
  const missing = DAEMON_REQUIRED_SCOPES.filter(
    (scope) => !available.has(scope),
  );
  if (missing.length > 0) {
    throw new Error(
      'Daemon startup credential is missing required scopes: ' +
        `${missing.join(' ')}. Issue a replacement credential with ` +
        `${DAEMON_REQUIRED_SCOPES.join(' ')}.`,
    );
  }
  if (!available.has(DAEMON_SIGNING_SCOPE)) {
    onWarn?.(
      `Daemon startup credential lacks ${DAEMON_SIGNING_SCOPE}. The daemon ` +
        'still starts, but any task whose runtime policy grants ' +
        'capability:agent-signing will fail when guest code signs a diary ' +
        'entry or a commit. Reissue the credential with ' +
        `${[...DAEMON_REQUIRED_SCOPES, DAEMON_SIGNING_SCOPE].join(' ')} if ` +
        'this worker signs.',
    );
  }
}

export async function validateExecutorSigningIdentity(input: {
  whoami: Whoami;
  signingPrivateKey: string;
}): Promise<void> {
  let publicKey: string;
  try {
    publicKey = await cryptoService.derivePublicKey(input.signingPrivateKey);
  } catch {
    throw new Error(
      'Daemon executor signing material is not a valid base64-encoded Ed25519 private key seed.',
    );
  }
  if (!input.whoami.publicKey || !input.whoami.fingerprint) {
    throw new Error(
      'Daemon startup whoami response did not include the authenticated agent public key and fingerprint.',
    );
  }
  let authenticatedPublicKey: string;
  try {
    authenticatedPublicKey = normalizeEd25519PublicKey(input.whoami.publicKey);
  } catch {
    throw new Error(
      'Daemon startup whoami response included an invalid authenticated agent public key.',
    );
  }
  const fingerprint = cryptoService.getFingerprintFromPublicKey(publicKey);
  const authenticatedFingerprint = cryptoService.getFingerprintFromPublicKey(
    authenticatedPublicKey,
  );
  if (
    authenticatedPublicKey !== publicKey ||
    authenticatedFingerprint !== input.whoami.fingerprint ||
    fingerprint !== input.whoami.fingerprint
  ) {
    throw new Error(
      'Daemon executor signing key does not match the authenticated agent ' +
        `(expected ${input.whoami.fingerprint}, derived ${fingerprint}).`,
    );
  }
}

function normalizeEd25519PublicKey(value: string): string {
  const encoded = value.trim().replace(/^ed25519:/, '');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded)) {
    throw new Error('invalid public key');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== 32) {
    throw new Error('invalid public key');
  }
  return `ed25519:${bytes.toString('base64')}`;
}

export function attestPreparedRuntime(
  prepared: PreparedDaemonRuntime,
  signingPrivateKey: string,
): AttestedDaemonRuntime {
  const attestor = createExecutorAttestor({
    manifest: prepared.manifest,
    signingPrivateKey,
  });
  return Object.assign(prepared, { attestor });
}

/**
 * {@link validateDaemonScopes} plus structured delivery of its warning. Kept
 * separate so the check itself stays pure and unit-testable.
 */
export async function validateDaemonScopesLogged(
  whoami: Whoami,
  context: {
    serviceName: string;
    level: string;
    agent: string;
    authMode: string;
  },
): Promise<void> {
  const warnings: string[] = [];
  validateDaemonScopes(whoami, (message) => warnings.push(message));
  for (const message of warnings) {
    await logDaemonStartupWarning({ ...context, message });
  }
}
