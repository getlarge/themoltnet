/**
 * SSH key format conversion for MoltNet Ed25519 keys
 *
 * Converts MoltNet agent keys (ed25519:<base64>) to OpenSSH format
 * for use with git commit signing and SSH authentication.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'crypto';

// Ensure sha512Sync is configured (may already be set by crypto.service.ts)
if (!ed.etc.sha512Sync) {
  ed.etc.sha512Sync = (...m) => {
    const hash = createHash('sha512');
    m.forEach((msg) => hash.update(msg));
    return hash.digest();
  };
}

const SSH_ED25519_KEY_TYPE = 'ssh-ed25519';
const AUTH_MAGIC = 'openssh-key-v1\0';
const CIPHER_NONE = 'none';

/**
 * Encode a 32-bit unsigned integer in big-endian format.
 */
function encodeUInt32(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n, 0);
  return buf;
}

/**
 * Encode a byte sequence as an SSH string (uint32 length prefix + data).
 */
function encodeSSHString(data: Buffer | string): Buffer {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return Buffer.concat([encodeUInt32(buf.length), buf]);
}

/**
 * Convert a MoltNet public key to SSH public key format.
 *
 * @param moltnetPublicKey - Key in `ed25519:<base64>` format
 * @returns SSH public key string: `ssh-ed25519 <base64>`
 * @throws Error if the key format is invalid or the key is not 32 bytes
 */
export function toSSHPublicKey(moltnetPublicKey: string): string {
  const match = moltnetPublicKey.match(/^ed25519:(.+)$/);
  if (!match) {
    throw new Error(
      'Invalid MoltNet public key format: expected "ed25519:<base64>"',
    );
  }

  const pubkeyBytes = Buffer.from(match[1], 'base64');
  if (pubkeyBytes.length !== 32) {
    throw new Error(
      `Invalid Ed25519 public key length: expected 32 bytes, got ${pubkeyBytes.length}`,
    );
  }

  const blob = Buffer.concat([
    encodeSSHString(SSH_ED25519_KEY_TYPE),
    encodeSSHString(pubkeyBytes),
  ]);

  return `${SSH_ED25519_KEY_TYPE} ${blob.toString('base64')}`;
}

/**
 * Convert a MoltNet seed (private key) to OpenSSH PEM private key format.
 *
 * Produces an unencrypted OpenSSH private key per the PROTOCOL.key spec.
 * Uses deterministic zero checkints for reproducible output.
 *
 * @param seedBase64 - Base64-encoded 32-byte Ed25519 seed
 * @returns OpenSSH PEM private key string
 * @throws Error if the seed is not 32 bytes
 */
export function toSSHPrivateKey(seedBase64: string): string {
  const seed = Buffer.from(seedBase64, 'base64');
  if (seed.length !== 32) {
    throw new Error(
      `Invalid Ed25519 seed length: expected 32 bytes, got ${seed.length}`,
    );
  }

  // Derive public key from seed (synchronous via sha512Sync)
  const pubkeyBytes = Buffer.from(ed.getPublicKey(seed));

  // Build the public key blob (same as SSH wire format)
  const pubkeyBlob = Buffer.concat([
    encodeSSHString(SSH_ED25519_KEY_TYPE),
    encodeSSHString(pubkeyBytes),
  ]);

  // Build the private section
  // checkint x2 (deterministic zeros for unencrypted key)
  const checkInt = encodeUInt32(0x00000000);

  // Ed25519 private key in OpenSSH format is seed || pubkey (64 bytes)
  const privkeyData = Buffer.concat([seed, pubkeyBytes]);

  const comment = Buffer.alloc(0);

  const privateSection = Buffer.concat([
    checkInt, // checkint1
    checkInt, // checkint2
    encodeSSHString(SSH_ED25519_KEY_TYPE), // keytype
    encodeSSHString(pubkeyBytes), // pubkey
    encodeSSHString(privkeyData), // privkey (seed + pubkey)
    encodeSSHString(comment), // comment
  ]);

  // Add padding to align to 8-byte cipher block size
  const blockSize = 8;
  const padLength =
    blockSize - (privateSection.length % blockSize) === blockSize
      ? 0
      : blockSize - (privateSection.length % blockSize);
  const padding = Buffer.alloc(padLength);
  for (let i = 0; i < padLength; i++) {
    padding[i] = i + 1; // 1, 2, 3, ... per OpenSSH spec
  }

  const paddedPrivateSection = Buffer.concat([privateSection, padding]);

  // Build the full key binary
  const keyBinary = Buffer.concat([
    Buffer.from(AUTH_MAGIC, 'ascii'), // "openssh-key-v1\0"
    encodeSSHString(CIPHER_NONE), // ciphername
    encodeSSHString(CIPHER_NONE), // kdfname
    encodeSSHString(Buffer.alloc(0)), // kdf options (empty)
    encodeUInt32(1), // number of keys
    encodeSSHString(pubkeyBlob), // public key blob
    encodeSSHString(paddedPrivateSection), // private section
  ]);

  // PEM encode with 70-character line wrapping
  const base64 = keyBinary.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 70) {
    lines.push(base64.slice(i, i + 70));
  }

  return [
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    ...lines,
    '-----END OPENSSH PRIVATE KEY-----',
    '', // trailing newline
  ].join('\n');
}
