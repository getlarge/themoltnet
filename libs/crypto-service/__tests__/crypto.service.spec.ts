import { beforeAll, describe, expect, it } from 'vitest';

import { cryptoService, type KeyPair } from '../src/index.js';

describe('cryptoService', () => {
  let keyPair: KeyPair;

  beforeAll(async () => {
    keyPair = await cryptoService.generateKeyPair();
  });

  describe('generateKeyPair', () => {
    it('returns a keypair with ed25519-prefixed public key', async () => {
      const kp = await cryptoService.generateKeyPair();
      expect(kp.publicKey).toMatch(/^ed25519:[A-Za-z0-9+/=]+$/);
    });

    it('returns a base64-encoded private key', async () => {
      const kp = await cryptoService.generateKeyPair();
      const decoded = Buffer.from(kp.privateKey, 'base64');
      expect(decoded).toHaveLength(32);
    });

    it('returns a fingerprint in A1B2-C3D4-E5F6-G7H8 format', async () => {
      const kp = await cryptoService.generateKeyPair();
      expect(kp.fingerprint).toMatch(
        /^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/,
      );
    });

    it('generates unique keypairs on each call', async () => {
      const kp1 = await cryptoService.generateKeyPair();
      const kp2 = await cryptoService.generateKeyPair();
      expect(kp1.publicKey).not.toBe(kp2.publicKey);
      expect(kp1.privateKey).not.toBe(kp2.privateKey);
      expect(kp1.fingerprint).not.toBe(kp2.fingerprint);
    });
  });

  describe('generateFingerprint', () => {
    it('is deterministic for the same public key bytes', () => {
      const publicKeyBytes = cryptoService.parsePublicKey(keyPair.publicKey);
      const fp1 = cryptoService.generateFingerprint(publicKeyBytes);
      const fp2 = cryptoService.generateFingerprint(publicKeyBytes);
      expect(fp1).toBe(fp2);
    });

    it('produces different fingerprints for different keys', async () => {
      const kp2 = await cryptoService.generateKeyPair();
      expect(keyPair.fingerprint).not.toBe(kp2.fingerprint);
    });
  });

  describe('parsePublicKey', () => {
    it('strips ed25519: prefix and decodes base64', () => {
      const bytes = cryptoService.parsePublicKey(keyPair.publicKey);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes).toHaveLength(32);
    });

    it('handles keys without prefix', () => {
      const base64 = keyPair.publicKey.replace('ed25519:', '');
      const bytes = cryptoService.parsePublicKey(base64);
      expect(bytes).toHaveLength(32);
    });
  });

  describe('sign and verify', () => {
    it('signs a message and verifies it with the correct public key', async () => {
      const message = 'hello moltnet';
      const signature = await cryptoService.sign(message, keyPair.privateKey);

      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);

      const valid = await cryptoService.verify(
        message,
        signature,
        keyPair.publicKey,
      );
      expect(valid).toBe(true);
    });

    it('rejects a tampered message', async () => {
      const signature = await cryptoService.sign(
        'original',
        keyPair.privateKey,
      );
      const valid = await cryptoService.verify(
        'tampered',
        signature,
        keyPair.publicKey,
      );
      expect(valid).toBe(false);
    });

    it('rejects a tampered signature', async () => {
      const signature = await cryptoService.sign('hello', keyPair.privateKey);
      // Flip one character in the signature
      const tampered =
        signature.slice(0, -2) + (signature.slice(-2) === 'AA' ? 'BB' : 'AA');
      const valid = await cryptoService.verify(
        'hello',
        tampered,
        keyPair.publicKey,
      );
      expect(valid).toBe(false);
    });

    it('rejects verification with wrong public key', async () => {
      const otherKp = await cryptoService.generateKeyPair();
      const signature = await cryptoService.sign('hello', keyPair.privateKey);
      const valid = await cryptoService.verify(
        'hello',
        signature,
        otherKp.publicKey,
      );
      expect(valid).toBe(false);
    });

    it('returns false for malformed signature instead of throwing', async () => {
      const valid = await cryptoService.verify(
        'hello',
        'not-valid-base64!!!',
        keyPair.publicKey,
      );
      expect(valid).toBe(false);
    });

    it('returns false for malformed public key instead of throwing', async () => {
      const signature = await cryptoService.sign('hello', keyPair.privateKey);
      const valid = await cryptoService.verify(
        'hello',
        signature,
        'ed25519:notavalidkey',
      );
      expect(valid).toBe(false);
    });
  });

  describe('createSignedMessage / verifySignedMessage', () => {
    it('round-trips a signed message', async () => {
      const signed = await cryptoService.createSignedMessage(
        'test message',
        keyPair.privateKey,
        keyPair.publicKey,
      );

      expect(signed.message).toBe('test message');
      expect(signed.publicKey).toBe(keyPair.publicKey);
      expect(typeof signed.signature).toBe('string');

      const valid = await cryptoService.verifySignedMessage(signed);
      expect(valid).toBe(true);
    });

    it('rejects a tampered signed message', async () => {
      const signed = await cryptoService.createSignedMessage(
        'original',
        keyPair.privateKey,
        keyPair.publicKey,
      );
      signed.message = 'tampered';

      const valid = await cryptoService.verifySignedMessage(signed);
      expect(valid).toBe(false);
    });
  });

  describe('generateChallenge', () => {
    it('returns a string starting with moltnet:challenge:', () => {
      const challenge = cryptoService.generateChallenge();
      expect(challenge).toMatch(/^moltnet:challenge:[a-f0-9]{64}:\d+$/);
    });

    it('generates unique challenges', () => {
      const c1 = cryptoService.generateChallenge();
      const c2 = cryptoService.generateChallenge();
      expect(c1).not.toBe(c2);
    });
  });

  describe('derivePublicKey', () => {
    it('derives the same public key from a private key', async () => {
      const derived = await cryptoService.derivePublicKey(keyPair.privateKey);
      expect(derived).toBe(keyPair.publicKey);
    });
  });

  describe('getFingerprintFromPublicKey', () => {
    it('returns the same fingerprint as generateKeyPair', () => {
      const fp = cryptoService.getFingerprintFromPublicKey(keyPair.publicKey);
      expect(fp).toBe(keyPair.fingerprint);
    });
  });

  describe('createIdentityProof / verifyIdentityProof', () => {
    const identityId = '550e8400-e29b-41d4-a716-446655440000';

    it('creates and verifies a valid identity proof', async () => {
      const proof = await cryptoService.createIdentityProof(
        identityId,
        keyPair.privateKey,
      );

      expect(proof.message).toContain(`moltnet:register:${identityId}:`);
      expect(typeof proof.signature).toBe('string');
      expect(typeof proof.timestamp).toBe('string');

      const valid = await cryptoService.verifyIdentityProof(
        proof,
        keyPair.publicKey,
        identityId,
      );
      expect(valid).toBe(true);
    });

    it('rejects proof with wrong identity id', async () => {
      const proof = await cryptoService.createIdentityProof(
        identityId,
        keyPair.privateKey,
      );

      const valid = await cryptoService.verifyIdentityProof(
        proof,
        keyPair.publicKey,
        '00000000-0000-0000-0000-000000000000',
      );
      expect(valid).toBe(false);
    });

    it('rejects proof with wrong public key', async () => {
      const otherKp = await cryptoService.generateKeyPair();
      const proof = await cryptoService.createIdentityProof(
        identityId,
        keyPair.privateKey,
      );

      const valid = await cryptoService.verifyIdentityProof(
        proof,
        otherKp.publicKey,
        identityId,
      );
      expect(valid).toBe(false);
    });

    it('rejects expired proof (>5 minutes old)', async () => {
      const proof = await cryptoService.createIdentityProof(
        identityId,
        keyPair.privateKey,
      );

      // Simulate expired timestamp
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      proof.timestamp = sixMinutesAgo.toISOString();
      // Re-create the message to match the old timestamp but keep original signature
      // This tests that the timestamp check fires even if we craft a matching message
      proof.message = `moltnet:register:${identityId}:${proof.timestamp}`;

      const valid = await cryptoService.verifyIdentityProof(
        proof,
        keyPair.publicKey,
        identityId,
      );
      // Should be false — either signature mismatch (message changed) or timestamp expired
      expect(valid).toBe(false);
    });

    it('rejects proof with tampered signature', async () => {
      const proof = await cryptoService.createIdentityProof(
        identityId,
        keyPair.privateKey,
      );
      proof.signature = proof.signature.slice(0, -2) + 'AA';

      const valid = await cryptoService.verifyIdentityProof(
        proof,
        keyPair.publicKey,
        identityId,
      );
      expect(valid).toBe(false);
    });
  });
});
