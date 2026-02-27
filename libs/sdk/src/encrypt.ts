import { cryptoService } from '@moltnet/crypto-service';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { randomBytes } from 'crypto';

import { readConfig } from './credentials.js';

const ENVELOPE_VERSION = 1;
const ALGORITHM = 'x25519-xchachapoly';
const HKDF_INFO = 'moltnet:seal:v1';

export interface SealedEnvelope {
  v: number;
  ephemeral_public_key: string;
  nonce: string;
  ciphertext: string;
  algorithm: string;
}

/**
 * Derive the local agent's X25519 keypair from credentials.
 */
export async function deriveEncryptionKeys(
  credentialsPath?: string,
): Promise<{ privateKey: string; publicKey: string }> {
  const config = await readConfig(credentialsPath);
  if (!config) {
    throw new Error('No credentials found — run `moltnet register` first');
  }
  const privateKey = cryptoService.deriveX25519PrivateKey(
    config.keys.private_key,
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
  const recipientX25519Pub = cryptoService.deriveX25519PublicKey(
    recipientEd25519PublicKey,
  );
  const recipientPubBytes = Buffer.from(
    recipientX25519Pub.replace('x25519:', ''),
    'base64',
  );

  // Generate ephemeral X25519 keypair
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);

  // ECDH shared secret
  const shared = x25519.getSharedSecret(ephPriv, recipientPubBytes);

  // KDF: derive 32-byte key from shared secret
  const key = hkdf(sha256, shared, undefined, HKDF_INFO, 32);

  // Encrypt with XChaCha20-Poly1305 (24-byte nonce)
  const nonce = randomBytes(24);
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(plaintextBytes);

  const envelope: SealedEnvelope = {
    v: ENVELOPE_VERSION,
    ephemeral_public_key: Buffer.from(ephPub).toString('base64'),
    nonce: Buffer.from(nonce).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
    algorithm: ALGORITHM,
  };

  return JSON.stringify(envelope);
}

/**
 * Decrypt a sealed envelope using the local agent's Ed25519 private key.
 */
export function decryptFromAgent(
  sealedEnvelopeJson: string,
  ed25519PrivateKeyBase64: string,
): string {
  const envelope = JSON.parse(sealedEnvelopeJson) as SealedEnvelope;

  if (envelope.v !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported envelope version: ${envelope.v}`);
  }
  if (envelope.algorithm !== ALGORITHM) {
    throw new Error(`Unsupported algorithm: ${envelope.algorithm}`);
  }

  const ephPub = new Uint8Array(
    Buffer.from(envelope.ephemeral_public_key, 'base64'),
  );
  const nonce = new Uint8Array(Buffer.from(envelope.nonce, 'base64'));
  const ciphertext = new Uint8Array(Buffer.from(envelope.ciphertext, 'base64'));

  // Derive X25519 private key from Ed25519 seed
  const x25519PrivB64 = cryptoService.deriveX25519PrivateKey(
    ed25519PrivateKeyBase64,
  );
  const x25519Priv = new Uint8Array(Buffer.from(x25519PrivB64, 'base64'));

  // ECDH shared secret
  const shared = x25519.getSharedSecret(x25519Priv, ephPub);

  // KDF
  const key = hkdf(sha256, shared, undefined, HKDF_INFO, 32);

  // Decrypt
  const cipher = xchacha20poly1305(key, nonce);
  const plaintext = cipher.decrypt(ciphertext);

  return new TextDecoder().decode(plaintext);
}

/**
 * Convenience wrapper: decrypt using credentials file.
 */
export async function decryptWithCredentials(
  sealedEnvelopeJson: string,
  credentialsPath?: string,
): Promise<string> {
  const config = await readConfig(credentialsPath);
  if (!config) {
    throw new Error('No credentials found — run `moltnet register` first');
  }
  return decryptFromAgent(sealedEnvelopeJson, config.keys.private_key);
}
