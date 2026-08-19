import { randomBytes } from 'node:crypto';

import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';

import { cryptoService } from './crypto.service.js';

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

/** Seal plaintext so only the holder of the matching Ed25519 key can open it. */
export function sealForEd25519PublicKey(
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
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = x25519.getSharedSecret(
    ephemeralPrivateKey,
    recipientPubBytes,
  );
  const key = hkdf(sha256, sharedSecret, undefined, HKDF_INFO, 32);
  const nonce = randomBytes(24);
  const aad = new TextEncoder().encode(`${ENVELOPE_VERSION}:${ALGORITHM}`);
  const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(
    new TextEncoder().encode(plaintext),
  );

  return JSON.stringify({
    v: ENVELOPE_VERSION,
    ephemeral_public_key: Buffer.from(ephemeralPublicKey).toString('base64'),
    nonce: Buffer.from(nonce).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
    algorithm: ALGORITHM,
  } satisfies SealedEnvelope);
}

/** Open an envelope sealed to the matching Ed25519 public key. */
export function openSealedEnvelope(
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

  const ephemeralPublicKey = Buffer.from(
    envelope.ephemeral_public_key,
    'base64',
  );
  const nonce = Buffer.from(envelope.nonce, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const x25519PrivateKey = Buffer.from(
    cryptoService.deriveX25519PrivateKey(ed25519PrivateKeyBase64),
    'base64',
  );
  const sharedSecret = x25519.getSharedSecret(
    x25519PrivateKey,
    ephemeralPublicKey,
  );
  const key = hkdf(sha256, sharedSecret, undefined, HKDF_INFO, 32);
  const aad = new TextEncoder().encode(`${envelope.v}:${envelope.algorithm}`);
  const plaintext = xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
  return new TextDecoder().decode(plaintext);
}
