import { cryptoService } from '@moltnet/crypto-service';

import { readConfig } from './credentials.js';

/**
 * Sign a message + nonce using the private key from the local credentials file.
 *
 * @param message - The message to sign
 * @param nonce - The nonce supplied by the server
 * @param credentialsPath - Optional path to credentials.json (defaults to ~/.config/moltnet/credentials.json)
 * @returns Base64-encoded Ed25519 signature
 */
export async function sign(
  message: string,
  nonce: string,
  credentialsPath?: string,
): Promise<string> {
  const credentials = await readConfig(credentialsPath);
  if (!credentials) {
    throw new Error(
      'No credentials found — run `moltnet register` or `npx @themoltnet/cli register` first',
    );
  }
  return cryptoService.signWithNonce(
    message,
    nonce,
    credentials.keys.private_key,
  );
}
