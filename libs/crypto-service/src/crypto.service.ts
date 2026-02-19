/**
 * MoltNet Crypto Service
 *
 * Ed25519 cryptographic operations for agent identity
 * Uses @noble/ed25519 for pure TypeScript implementation
 */

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'crypto';

// Use native crypto for SHA-512 (required by ed25519)
ed.etc.sha512Sync = (...m) => {
  const hash = createHash('sha512');
  m.forEach((msg) => hash.update(msg));
  return hash.digest();
};

export interface KeyPair {
  publicKey: string; // Base64 encoded with ed25519: prefix
  privateKey: string; // Base64 encoded (KEEP SECRET)
  fingerprint: string; // Human-readable: A1B2-C3D4-E5F6-G7H8
}

export interface SignedMessage {
  message: string;
  signature: string; // Base64 encoded
  publicKey: string;
}

/** Domain-separation prefix for the signing payload envelope. */
const DOMAIN_PREFIX = 'moltnet:v1';

/**
 * Build deterministic signing bytes with domain separation and
 * length-prefixed binary framing.
 *
 * Layout:
 *   UTF-8("moltnet:v1") || u32be(len(msg_hash)) || msg_hash || u32be(len(nonce_bytes)) || nonce_bytes
 *
 * Where msg_hash = SHA-256(UTF-8(message)).
 *
 * This produces a fixed-structure byte sequence immune to whitespace,
 * newline, and encoding differences between runtimes.
 */
export function buildSigningBytes(message: string, nonce: string): Uint8Array {
  const msgHash = createHash('sha256')
    .update(Buffer.from(message, 'utf-8'))
    .digest();
  const nonceBytes = Buffer.from(nonce, 'utf-8');
  const prefix = Buffer.from(DOMAIN_PREFIX, 'utf-8');

  const buf = Buffer.alloc(
    prefix.length + 4 + msgHash.length + 4 + nonceBytes.length,
  );
  let offset = 0;

  prefix.copy(buf, offset);
  offset += prefix.length;

  buf.writeUInt32BE(msgHash.length, offset);
  offset += 4;

  msgHash.copy(buf, offset);
  offset += msgHash.length;

  buf.writeUInt32BE(nonceBytes.length, offset);
  offset += 4;

  nonceBytes.copy(buf, offset);

  return new Uint8Array(buf);
}

export const cryptoService = {
  /**
   * Generate a new Ed25519 keypair
   */
  async generateKeyPair(): Promise<KeyPair> {
    // Generate 32-byte private key
    const privateKeyBytes = ed.utils.randomPrivateKey();

    // Derive public key
    const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes);

    // Encode as base64
    const privateKey = Buffer.from(privateKeyBytes).toString('base64');
    const publicKey = `ed25519:${Buffer.from(publicKeyBytes).toString('base64')}`;

    // Generate fingerprint from public key
    const fingerprint = this.generateFingerprint(publicKeyBytes);

    return { publicKey, privateKey, fingerprint };
  },

  /**
   * Generate human-readable fingerprint from public key
   * Format: A1B2-C3D4-E5F6-G7H8 (first 16 hex chars of SHA256)
   */
  generateFingerprint(publicKeyBytes: Uint8Array): string {
    const hash = createHash('sha256').update(publicKeyBytes).digest('hex');
    const segments = hash.slice(0, 16).toUpperCase().match(/.{4}/g) ?? [];
    return segments.join('-');
  },

  /**
   * Parse public key from string format
   */
  parsePublicKey(publicKey: string): Uint8Array {
    const base64 = publicKey.replace(/^ed25519:/, '');
    return new Uint8Array(Buffer.from(base64, 'base64'));
  },

  /**
   * Sign a message with private key
   */
  async sign(message: string, privateKeyBase64: string): Promise<string> {
    const privateKeyBytes = new Uint8Array(
      Buffer.from(privateKeyBase64, 'base64'),
    );
    const messageBytes = new TextEncoder().encode(message);

    const signature = await ed.signAsync(messageBytes, privateKeyBytes);

    return Buffer.from(signature).toString('base64');
  },

  /**
   * Verify a signature against a message and public key
   */
  async verify(
    message: string,
    signature: string,
    publicKey: string,
  ): Promise<boolean> {
    try {
      const publicKeyBytes = this.parsePublicKey(publicKey);
      const signatureBytes = new Uint8Array(Buffer.from(signature, 'base64'));
      const messageBytes = new TextEncoder().encode(message);

      return await ed.verifyAsync(signatureBytes, messageBytes, publicKeyBytes);
    } catch {
      return false;
    }
  },

  /**
   * Sign a (message, nonce) pair using deterministic pre-hash.
   * Uses buildSigningBytes for domain separation and canonical serialization.
   */
  async signWithNonce(
    message: string,
    nonce: string,
    privateKeyBase64: string,
  ): Promise<string> {
    const privateKeyBytes = new Uint8Array(
      Buffer.from(privateKeyBase64, 'base64'),
    );
    const signingBytes = buildSigningBytes(message, nonce);
    const signature = await ed.signAsync(signingBytes, privateKeyBytes);
    return Buffer.from(signature).toString('base64');
  },

  /**
   * Verify a signature produced by signWithNonce.
   */
  async verifyWithNonce(
    message: string,
    nonce: string,
    signature: string,
    publicKey: string,
  ): Promise<boolean> {
    try {
      const publicKeyBytes = this.parsePublicKey(publicKey);
      const signatureBytes = new Uint8Array(Buffer.from(signature, 'base64'));
      const signingBytes = buildSigningBytes(message, nonce);
      return await ed.verifyAsync(signatureBytes, signingBytes, publicKeyBytes);
    } catch {
      return false;
    }
  },

  /**
   * Create a signed message object
   */
  async createSignedMessage(
    message: string,
    privateKeyBase64: string,
    publicKey: string,
  ): Promise<SignedMessage> {
    const signature = await this.sign(message, privateKeyBase64);
    return { message, signature, publicKey };
  },

  /**
   * Verify a signed message object
   */
  async verifySignedMessage(signedMessage: SignedMessage): Promise<boolean> {
    return this.verify(
      signedMessage.message,
      signedMessage.signature,
      signedMessage.publicKey,
    );
  },

  /**
   * Generate a random challenge for authentication
   */
  generateChallenge(): string {
    return `moltnet:challenge:${randomBytes(32).toString('hex')}:${Date.now()}`;
  },

  /**
   * Derive public key from private key
   */
  async derivePublicKey(privateKeyBase64: string): Promise<string> {
    const privateKeyBytes = new Uint8Array(
      Buffer.from(privateKeyBase64, 'base64'),
    );
    const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes);
    return `ed25519:${Buffer.from(publicKeyBytes).toString('base64')}`;
  },

  /**
   * Get fingerprint from public key string
   */
  getFingerprintFromPublicKey(publicKey: string): string {
    const publicKeyBytes = this.parsePublicKey(publicKey);
    return this.generateFingerprint(publicKeyBytes);
  },

  /**
   * Create a proof of identity ownership (for DCR metadata)
   */
  async createIdentityProof(
    identityId: string,
    privateKeyBase64: string,
  ): Promise<{
    message: string;
    signature: string;
    timestamp: string;
  }> {
    const timestamp = new Date().toISOString();
    const message = `moltnet:register:${identityId}:${timestamp}`;
    const signature = await this.sign(message, privateKeyBase64);

    return { message, signature, timestamp };
  },

  /**
   * Verify an identity proof
   */
  async verifyIdentityProof(
    proof: { message: string; signature: string; timestamp: string },
    publicKey: string,
    expectedIdentityId: string,
  ): Promise<boolean> {
    // Verify signature
    const isValid = await this.verify(
      proof.message,
      proof.signature,
      publicKey,
    );
    if (!isValid) return false;

    // Verify message format contains expected identity
    const expectedPrefix = `moltnet:register:${expectedIdentityId}:`;
    if (!proof.message.startsWith(expectedPrefix)) return false;

    // Optionally check timestamp freshness (within 5 minutes)
    const proofTime = new Date(proof.timestamp).getTime();
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    if (now - proofTime > fiveMinutes) return false;

    return true;
  },
};

export type CryptoService = typeof cryptoService;
