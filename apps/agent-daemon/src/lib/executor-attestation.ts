import { cryptoService } from '@moltnet/crypto-service';
import {
  createExecutorAttestor,
  type ExecutorAttestor,
  readConfig,
  type Whoami,
} from '@themoltnet/sdk';

import type { PreparedDaemonRuntime } from '../runtime.js';
import type { DaemonAuthMode } from './agent-context.js';

export const DAEMON_REQUIRED_SCOPES = [
  'agent:profile',
  'runtime:read',
  'task:read',
  'task:claim',
  'task:execute',
] as const;

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
  const privateKey = config?.keys.private_key?.trim();
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
  const fingerprint = cryptoService.getFingerprintFromPublicKey(publicKey);
  if (!input.whoami.publicKey || !input.whoami.fingerprint) {
    throw new Error(
      'Daemon startup whoami response did not include the authenticated agent public key and fingerprint.',
    );
  }
  if (
    publicKey !== input.whoami.publicKey ||
    fingerprint !== input.whoami.fingerprint
  ) {
    throw new Error(
      'Daemon executor signing key does not match the authenticated agent ' +
        `(expected ${input.whoami.fingerprint}, derived ${fingerprint}).`,
    );
  }
}

export function attestPreparedRuntime(
  prepared: PreparedDaemonRuntime,
  signingPrivateKey: string,
): AttestedDaemonRuntime {
  const attestor = createExecutorAttestor({
    manifest: prepared.manifest,
    signingPrivateKey,
  });
  return { ...prepared, attestor };
}
