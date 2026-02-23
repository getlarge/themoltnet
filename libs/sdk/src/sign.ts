import { cryptoService } from '@moltnet/crypto-service';
import * as ed from '@noble/ed25519';

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

/**
 * Sign pre-framed bytes from a server-supplied `signing_input` field.
 *
 * Use this when the API has already computed the signing bytes (the
 * `signing_input` field of a SigningRequest response). No knowledge of the
 * binary framing protocol is required.
 *
 * @param signingInput - Base64-encoded bytes from the server's `signing_input` field
 * @param credentialsPath - Optional path to credentials directory (defaults to ~/.config/moltnet)
 * @returns Base64-encoded Ed25519 signature
 */
export async function signBytes(
  signingInput: string,
  credentialsPath?: string,
): Promise<string> {
  const credentials = await readConfig(credentialsPath);
  if (!credentials) {
    throw new Error(
      'No credentials found — run `moltnet register` or `npx @themoltnet/cli register` first',
    );
  }
  // The server already applied buildSigningBytes framing; sign the raw bytes directly.
  // Uses the same ed.signAsync primitive as cryptoService.signWithNonce, bypassing
  // the buildSigningBytes step.
  const privateKeyBytes = new Uint8Array(
    Buffer.from(credentials.keys.private_key, 'base64'),
  );
  const rawBytes = new Uint8Array(Buffer.from(signingInput, 'base64'));
  const signature = await ed.signAsync(rawBytes, privateKeyBytes);
  return Buffer.from(signature).toString('base64');
}
