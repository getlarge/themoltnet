import { cryptoService } from '@moltnet/crypto-service';
import * as ed from '@noble/ed25519';

import { resolveIdentitySeed } from './credential-resolver.js';
import { readConfig } from './credentials.js';
import {
  createDefaultSecretProviderRegistry,
  type SecretProviderRegistry,
} from './secrets.js';

async function loadSeed(
  credentialsPath: string | undefined,
  secretProviders: SecretProviderRegistry,
): Promise<string> {
  const credentials = await readConfig(credentialsPath);
  if (!credentials) {
    throw new Error(
      'No credentials found — run `moltnet register` or `npx @themoltnet/cli register` first',
    );
  }
  return resolveIdentitySeed(credentials, secretProviders);
}

/**
 * Sign a message + nonce using the private key from the local credentials file.
 *
 * @param message - The message to sign
 * @param nonce - The nonce supplied by the server
 * @param credentialsPath - Optional config directory containing moltnet.json (defaults to ~/.config/moltnet)
 * @param secretProviders - Registry used to resolve `keys.private_key_ref`.
 *   Defaults to the environment-only registry; pass
 *   `createNodeSecretProviderRegistry()` from `@themoltnet/sdk/node` for
 *   OS-keyring or file references.
 * @returns Base64-encoded Ed25519 signature
 */
export async function sign(
  message: string,
  nonce: string,
  credentialsPath?: string,
  secretProviders: SecretProviderRegistry = createDefaultSecretProviderRegistry(),
): Promise<string> {
  return cryptoService.signWithNonce(
    message,
    nonce,
    await loadSeed(credentialsPath, secretProviders),
  );
}

/**
 * Sign pre-framed bytes from a server-supplied `signing_input` field.
 *
 * Use this when the API has already computed the signing bytes (the
 * `signing_input` field of a SigningRequest response). No knowledge of the
 * binary framing protocol is required.
 *
 * @param signingInput - Base64-encoded bytes from the server's `signing_input` field
 * @param credentialsPath - Optional path to credentials directory (defaults to ~/.config/moltnet)
 * @param secretProviders - Registry used to resolve `keys.private_key_ref`
 *   (see {@link sign}).
 * @returns Base64-encoded Ed25519 signature
 */
export async function signBytes(
  signingInput: string,
  credentialsPath?: string,
  secretProviders: SecretProviderRegistry = createDefaultSecretProviderRegistry(),
): Promise<string> {
  // The server already applied buildSigningBytes framing; sign the raw bytes directly.
  const privateKeyBytes = new Uint8Array(
    Buffer.from(await loadSeed(credentialsPath, secretProviders), 'base64'),
  );
  const rawBytes = new Uint8Array(Buffer.from(signingInput, 'base64'));
  const signature = await ed.signAsync(rawBytes, privateKeyBytes);
  return Buffer.from(signature).toString('base64');
}
