import {
  cryptoService,
  openSealedEnvelope,
  type SealedEnvelope,
  sealForEd25519PublicKey,
} from '@moltnet/crypto-service';

import { resolveIdentitySeed } from './credential-resolver.js';
import { readConfig } from './credentials.js';
import {
  createDefaultSecretProviderRegistry,
  type SecretProviderRegistry,
} from './secrets.js';

export type { SealedEnvelope };

/**
 * Derive the local agent's X25519 keypair from credentials.
 *
 * `secretProviders` resolves `keys.private_key_ref`; it defaults to the
 * environment-only registry (pass `createNodeSecretProviderRegistry()` from
 * `@themoltnet/sdk/node` for OS-keyring or file references).
 */
export async function deriveEncryptionKeys(
  credentialsPath?: string,
  secretProviders: SecretProviderRegistry = createDefaultSecretProviderRegistry(),
): Promise<{ privateKey: string; publicKey: string }> {
  const config = await readConfig(credentialsPath);
  if (!config) {
    throw new Error('No credentials found — run `moltnet register` first');
  }
  const privateKey = cryptoService.deriveX25519PrivateKey(
    await resolveIdentitySeed(config, secretProviders),
  );
  const publicKey = cryptoService.deriveX25519PublicKey(config.keys.public_key);
  return { privateKey, publicKey };
}

/**
 * Encrypt plaintext for a recipient identified by their Ed25519 public key.
 * Uses ephemeral X25519 ECDH + HKDF-SHA256 + XChaCha20-Poly1305.
 */
export function encryptForAgent(
  plaintext: string,
  recipientEd25519PublicKey: string,
): string {
  return sealForEd25519PublicKey(plaintext, recipientEd25519PublicKey);
}

/**
 * Decrypt a sealed envelope using the local agent's Ed25519 private key.
 */
export function decryptFromAgent(
  sealedEnvelopeJson: string,
  ed25519PrivateKeyBase64: string,
): string {
  return openSealedEnvelope(sealedEnvelopeJson, ed25519PrivateKeyBase64);
}

/**
 * Convenience wrapper: decrypt using credentials file.
 */
export async function decryptWithCredentials(
  sealedEnvelopeJson: string,
  credentialsPath?: string,
  secretProviders: SecretProviderRegistry = createDefaultSecretProviderRegistry(),
): Promise<string> {
  const config = await readConfig(credentialsPath);
  if (!config) {
    throw new Error('No credentials found — run `moltnet register` first');
  }
  return decryptFromAgent(
    sealedEnvelopeJson,
    await resolveIdentitySeed(config, secretProviders),
  );
}
