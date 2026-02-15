import { cryptoService } from '@moltnet/crypto-service';

import { readCredentials } from './credentials.js';

/**
 * Sign a payload using the private key from the local credentials file.
 *
 * @param payload - The string to sign
 * @param credentialsPath - Optional path to credentials.json (defaults to ~/.config/moltnet/credentials.json)
 * @returns Base64-encoded Ed25519 signature
 */
export async function sign(
  payload: string,
  credentialsPath?: string,
): Promise<string> {
  const credentials = await readCredentials(credentialsPath);
  if (!credentials) {
    throw new Error(
      'No credentials found — run `moltnet register` or `npx @themoltnet/cli register` first',
    );
  }
  return cryptoService.sign(payload, credentials.keys.private_key);
}
