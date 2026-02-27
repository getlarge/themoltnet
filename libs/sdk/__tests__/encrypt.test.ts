import { cryptoService, type KeyPair } from '@moltnet/crypto-service';
import { describe, expect, it } from 'vitest';

import {
  decryptFromAgent,
  encryptForAgent,
  type SealedEnvelope,
} from '../src/encrypt.js';

describe('encrypt / decrypt', () => {
  let alice: KeyPair;
  let bob: KeyPair;

  it('setup: generate two keypairs', async () => {
    alice = await cryptoService.generateKeyPair();
    bob = await cryptoService.generateKeyPair();
  });

  describe('encryptForAgent', () => {
    it('returns a valid JSON sealed envelope', () => {
      const sealed = encryptForAgent('hello bob', bob.publicKey);
      const envelope: SealedEnvelope = JSON.parse(sealed);
      expect(envelope.v).toBe(1);
      expect(envelope.algorithm).toBe('x25519-xchachapoly');
      expect(envelope.ephemeral_public_key).toBeTruthy();
      expect(envelope.nonce).toBeTruthy();
      expect(envelope.ciphertext).toBeTruthy();
    });

    it('produces unique ciphertext on each call (ephemeral key)', () => {
      const sealed1 = encryptForAgent('same msg', bob.publicKey);
      const sealed2 = encryptForAgent('same msg', bob.publicKey);
      const e1: SealedEnvelope = JSON.parse(sealed1);
      const e2: SealedEnvelope = JSON.parse(sealed2);
      expect(e1.ephemeral_public_key).not.toBe(e2.ephemeral_public_key);
      expect(e1.ciphertext).not.toBe(e2.ciphertext);
    });
  });

  describe('decryptFromAgent', () => {
    it('round-trips: encrypt for bob, bob decrypts', () => {
      const plaintext = 'secret message for bob';
      const sealed = encryptForAgent(plaintext, bob.publicKey);
      const decrypted = decryptFromAgent(sealed, bob.privateKey);
      expect(decrypted).toBe(plaintext);
    });

    it('works with unicode content', () => {
      const plaintext = 'こんにちは世界 🌍 \u0000 null byte';
      const sealed = encryptForAgent(plaintext, bob.publicKey);
      const decrypted = decryptFromAgent(sealed, bob.privateKey);
      expect(decrypted).toBe(plaintext);
    });

    it('works with empty string', () => {
      const sealed = encryptForAgent('', bob.publicKey);
      const decrypted = decryptFromAgent(sealed, bob.privateKey);
      expect(decrypted).toBe('');
    });

    it('fails with wrong private key', () => {
      const sealed = encryptForAgent('for bob only', bob.publicKey);
      expect(() => decryptFromAgent(sealed, alice.privateKey)).toThrow();
    });

    it('fails with tampered ciphertext', () => {
      const sealed = encryptForAgent('secret', bob.publicKey);
      const envelope: SealedEnvelope = JSON.parse(sealed);
      // Flip a byte in ciphertext
      const ct = Buffer.from(envelope.ciphertext, 'base64');
      ct[0] ^= 0xff;
      envelope.ciphertext = ct.toString('base64');
      expect(() =>
        decryptFromAgent(JSON.stringify(envelope), bob.privateKey),
      ).toThrow();
    });

    it('rejects unsupported version', () => {
      const sealed = encryptForAgent('test', bob.publicKey);
      const envelope: SealedEnvelope = JSON.parse(sealed);
      envelope.v = 99;
      expect(() =>
        decryptFromAgent(JSON.stringify(envelope), bob.privateKey),
      ).toThrow('Unsupported envelope version');
    });

    it('rejects unsupported algorithm', () => {
      const sealed = encryptForAgent('test', bob.publicKey);
      const envelope: SealedEnvelope = JSON.parse(sealed);
      envelope.algorithm = 'aes-256-gcm';
      expect(() =>
        decryptFromAgent(JSON.stringify(envelope), bob.privateKey),
      ).toThrow('Unsupported algorithm');
    });
  });

  describe('large payloads', () => {
    it('encrypts and decrypts 10KB of text', () => {
      const large = 'x'.repeat(10_000);
      const sealed = encryptForAgent(large, bob.publicKey);
      const decrypted = decryptFromAgent(sealed, bob.privateKey);
      expect(decrypted).toBe(large);
    });
  });
});
