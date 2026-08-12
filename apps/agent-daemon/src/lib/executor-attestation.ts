import { cryptoService } from '@moltnet/crypto-service';
import { AGENT_CREDENTIAL_SCOPES } from '@moltnet/models';
import {
  createExecutorAttestor,
  type ExecutorAttestor,
  readConfig,
  type Whoami,
} from '@themoltnet/sdk';

import type { PreparedDaemonRuntime } from '../runtime.js';
import type { DaemonAuthMode } from './agent-context.js';

export const DAEMON_REQUIRED_SCOPES = AGENT_CREDENTIAL_SCOPES;

export interface AttestedDaemonRuntime extends PreparedDaemonRuntime {
  readonly attestor: ExecutorAttestor;
}

export async function resolveExecutorSigningPrivateKey(input: {
  authMode: DaemonAuthMode;
  agentDir: string;
  configuredPrivateKey: string;
}): Promise<string> {
  if (input.authMode === 'agent-key') {
    const privateKey = input.configuredPrivateKey.trim();
    if (!privateKey) {
      throw new Error(
        'Agent-key daemon startup requires MOLTNET_PRIVATE_KEY containing the base64-encoded Ed25519 private key seed.',
      );
    }
    return privateKey;
  }

  const config = await readConfig(input.agentDir);
  const privateKey = config?.keys?.private_key?.trim();
  if (!privateKey) {
    throw new Error(
      `OAuth2 daemon startup requires keys.private_key in ${input.agentDir}/moltnet.json.`,
    );
  }
  return privateKey;
}

export function validateDaemonScopes(whoami: Whoami): void {
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
