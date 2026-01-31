/**
 * Ed25519 Frozen Test Vectors
 *
 * These vectors are generated from @noble/ed25519 with deterministic seeds
 * and frozen as constants. If any test fails, the crypto library has been
 * silently broken, replaced, or tampered with.
 *
 * This is a mission integrity safeguard — see docs/MISSION_INTEGRITY.md (T7).
 *
 * DO NOT regenerate these vectors unless you are intentionally upgrading
 * the crypto library and have verified the new behavior is correct.
 */

import { describe, expect, it } from 'vitest';

import { cryptoService } from '../src/crypto.service.js';

// Vector 1: deterministic seed (0x00...01), non-empty message
const VECTOR_1 = {
  privateKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=',
  publicKey: 'ed25519:TLWr9q15+/WrvMr8wmnYXNJlHtS4hbWGnyQa7fCluik=',
  message: 'moltnet:test-vector:integrity',
  signature:
    'JMuBP2p/d8I6llnHST4gZ0fRPS8hISUirExoBfNSLllSdB6qaxKLJKVNX747lKDP3QLMC2wlRznKH8we3Q0+BA==',
};

// Vector 2: deterministic seed (0xdeadbeef...), empty message
const VECTOR_2 = {
  privateKey: '3q2+796tvu/erb7v3q2+796tvu/erb7v3q2+796tvu8=',
  publicKey: 'ed25519:/1dXXcevi/xNCDfMHOIBe2hqiBRdxVealY40Yv6akI4=',
  message: '',
  signature:
    'zX3Dff/5w9ylZlmtWfbkL1W8YEgeuvtzfaxU9qf4pWRE5YCH3ZuLZS412NLxunU6ek2aBJACPsZ/V0AkQCTnDQ==',
};

describe('Ed25519 Frozen Test Vectors', () => {
  describe('public key derivation', () => {
    it('vector 1: derives expected public key from seed', async () => {
      const derived = await cryptoService.derivePublicKey(VECTOR_1.privateKey);
      expect(derived).toBe(VECTOR_1.publicKey);
    });

    it('vector 2: derives expected public key from seed', async () => {
      const derived = await cryptoService.derivePublicKey(VECTOR_2.privateKey);
      expect(derived).toBe(VECTOR_2.publicKey);
    });
  });

  describe('signature verification', () => {
    it('vector 1: verifies frozen signature', async () => {
      const valid = await cryptoService.verify(
        VECTOR_1.message,
        VECTOR_1.signature,
        VECTOR_1.publicKey,
      );
      expect(valid).toBe(true);
    });

    it('vector 2: verifies frozen signature (empty message)', async () => {
      const valid = await cryptoService.verify(
        VECTOR_2.message,
        VECTOR_2.signature,
        VECTOR_2.publicKey,
      );
      expect(valid).toBe(true);
    });

    it('rejects tampered signature (bit flip)', async () => {
      const sigBytes = Buffer.from(VECTOR_1.signature, 'base64');
      sigBytes[0] ^= 0x01;
      const tampered = sigBytes.toString('base64');

      const valid = await cryptoService.verify(
        VECTOR_1.message,
        tampered,
        VECTOR_1.publicKey,
      );
      expect(valid).toBe(false);
    });

    it('rejects signature against wrong public key', async () => {
      const valid = await cryptoService.verify(
        VECTOR_1.message,
        VECTOR_1.signature,
        VECTOR_2.publicKey,
      );
      expect(valid).toBe(false);
    });

    it('rejects signature against wrong message', async () => {
      const valid = await cryptoService.verify(
        VECTOR_1.message + ' tampered',
        VECTOR_1.signature,
        VECTOR_1.publicKey,
      );
      expect(valid).toBe(false);
    });
  });

  describe('fingerprint consistency', () => {
    it('vector 1: produces expected fingerprint format', () => {
      const fp = cryptoService.getFingerprintFromPublicKey(VECTOR_1.publicKey);
      expect(fp).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
    });

    it('vector 1: fingerprint is deterministic', () => {
      const fp1 = cryptoService.getFingerprintFromPublicKey(VECTOR_1.publicKey);
      const fp2 = cryptoService.getFingerprintFromPublicKey(VECTOR_1.publicKey);
      expect(fp1).toBe(fp2);
    });

    it('different keys produce different fingerprints', () => {
      const fp1 = cryptoService.getFingerprintFromPublicKey(VECTOR_1.publicKey);
      const fp2 = cryptoService.getFingerprintFromPublicKey(VECTOR_2.publicKey);
      expect(fp1).not.toBe(fp2);
    });
  });
});

describe('Ed25519 Structural Properties', () => {
  it('produces 64-byte signatures', async () => {
    const keyPair = await cryptoService.generateKeyPair();
    const signature = await cryptoService.sign('test', keyPair.privateKey);
    const sigBytes = Buffer.from(signature, 'base64');
    expect(sigBytes.length).toBe(64);
  });

  it('produces 32-byte public keys', async () => {
    const keyPair = await cryptoService.generateKeyPair();
    const pubBytes = cryptoService.parsePublicKey(keyPair.publicKey);
    expect(pubBytes.length).toBe(32);
  });

  it('signatures are deterministic for same key and message', async () => {
    const keyPair = await cryptoService.generateKeyPair();
    const message = 'moltnet:determinism-check';
    const sig1 = await cryptoService.sign(message, keyPair.privateKey);
    const sig2 = await cryptoService.sign(message, keyPair.privateKey);
    expect(sig1).toBe(sig2);
  });

  it('sign-verify round trip succeeds', async () => {
    const keyPair = await cryptoService.generateKeyPair();
    const message = 'moltnet:round-trip-check';
    const signature = await cryptoService.sign(message, keyPair.privateKey);
    const valid = await cryptoService.verify(
      message,
      signature,
      keyPair.publicKey,
    );
    expect(valid).toBe(true);
  });

  it('identity proof round trip succeeds', async () => {
    const keyPair = await cryptoService.generateKeyPair();
    const identityId = '00000000-0000-0000-0000-000000000001';
    const proof = await cryptoService.createIdentityProof(
      identityId,
      keyPair.privateKey,
    );
    const valid = await cryptoService.verifyIdentityProof(
      proof,
      keyPair.publicKey,
      identityId,
    );
    expect(valid).toBe(true);
  });
});
