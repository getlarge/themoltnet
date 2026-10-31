import { describe, expect, it } from 'vitest';

import { cryptoService, type KeyPair } from '../src/index.js';

describe('X25519 key derivation', () => {
  let keyPair: KeyPair;

  // Generate a fixed keypair for determinism tests
  it('setup: generate keypair', async () => {
    keyPair = await cryptoService.generateKeyPair();
  });

  describe('deriveX25519PrivateKey', () => {
    it('returns a 32-byte base64-encoded key', () => {
      const x25519Priv = cryptoService.deriveX25519PrivateKey(
        keyPair.privateKey,
      );
      const decoded = Buffer.from(x25519Priv, 'base64');
      expect(decoded).toHaveLength(32);
    });

    it('is deterministic — same Ed25519 seed always produces same X25519 key', () => {
      const x1 = cryptoService.deriveX25519PrivateKey(keyPair.privateKey);
      const x2 = cryptoService.deriveX25519PrivateKey(keyPair.privateKey);
      expect(x1).toBe(x2);
    });

    it('produces different X25519 keys for different Ed25519 seeds', async () => {
      const otherKp = await cryptoService.generateKeyPair();
      const x1 = cryptoService.deriveX25519PrivateKey(keyPair.privateKey);
      const x2 = cryptoService.deriveX25519PrivateKey(otherKp.privateKey);
      expect(x1).not.toBe(x2);
    });

    it('clamped correctly — low 3 bits clear, bit 254 set', () => {
      const x25519Priv = cryptoService.deriveX25519PrivateKey(
        keyPair.privateKey,
      );
      const bytes = Buffer.from(x25519Priv, 'base64');
      // RFC 7748 clamping: bits 0,1,2 of first byte are 0; bit 6 of last byte is 1; bit 7 of last byte is 0
      expect(bytes[0] & 0x07).toBe(0);
      expect(bytes[31] & 0x40).toBe(0x40);
      expect(bytes[31] & 0x80).toBe(0);
    });
  });

  describe('deriveX25519PublicKey', () => {
    it('returns a key with x25519: prefix', () => {
      const x25519Pub = cryptoService.deriveX25519PublicKey(keyPair.publicKey);
      expect(x25519Pub).toMatch(/^x25519:[A-Za-z0-9+/=]+$/);
    });

    it('decodes to 32 bytes', () => {
      const x25519Pub = cryptoService.deriveX25519PublicKey(keyPair.publicKey);
      const base64 = x25519Pub.replace('x25519:', '');
      const decoded = Buffer.from(base64, 'base64');
      expect(decoded).toHaveLength(32);
    });

    it('is deterministic', () => {
      const p1 = cryptoService.deriveX25519PublicKey(keyPair.publicKey);
      const p2 = cryptoService.deriveX25519PublicKey(keyPair.publicKey);
      expect(p1).toBe(p2);
    });

    it('works with or without ed25519: prefix', () => {
      const withPrefix = cryptoService.deriveX25519PublicKey(keyPair.publicKey);
      const base64Only = keyPair.publicKey.replace('ed25519:', '');
      const withoutPrefix = cryptoService.deriveX25519PublicKey(base64Only);
      expect(withPrefix).toBe(withoutPrefix);
    });

    it('produces different keys for different Ed25519 public keys', async () => {
      const otherKp = await cryptoService.generateKeyPair();
      const x1 = cryptoService.deriveX25519PublicKey(keyPair.publicKey);
      const x2 = cryptoService.deriveX25519PublicKey(otherKp.publicKey);
      expect(x1).not.toBe(x2);
    });
  });

  describe('private/public consistency', () => {
    it('derived X25519 public key matches what x25519.getPublicKey would produce from the derived private key', async () => {
      const { x25519 } = await import('@noble/curves/ed25519.js');

      const x25519Priv = cryptoService.deriveX25519PrivateKey(
        keyPair.privateKey,
      );
      const x25519Pub = cryptoService.deriveX25519PublicKey(keyPair.publicKey);

      const privBytes = Buffer.from(x25519Priv, 'base64');
      const computedPub = x25519.getPublicKey(privBytes);
      const computedPubB64 = `x25519:${Buffer.from(computedPub).toString('base64')}`;

      expect(x25519Pub).toBe(computedPubB64);
    });
  });
});
