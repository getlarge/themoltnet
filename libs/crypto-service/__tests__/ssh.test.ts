import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cryptoService } from '../src/crypto.service.js';
import { toSSHPrivateKey, toSSHPublicKey } from '../src/ssh.js';

interface TestVector {
  description: string;
  seed_base64: string;
  public_key_moltnet: string;
  public_key_ssh: string;
}

const fixtures = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../test-fixtures/ssh-key-vectors.json'),
    'utf-8',
  ),
) as { vectors: TestVector[] };

const { vectors } = fixtures;

describe('toSSHPublicKey', () => {
  it.each(vectors)(
    'converts MoltNet public key to SSH format ($description)',
    (vector) => {
      // Arrange
      const moltnetKey = vector.public_key_moltnet;

      // Act
      const sshKey = toSSHPublicKey(moltnetKey);

      // Assert
      expect(sshKey).toBe(vector.public_key_ssh);
    },
  );

  it('throws on invalid input', () => {
    expect(() => toSSHPublicKey('invalid')).toThrow();
  });

  it('throws on wrong-length key data', () => {
    // 16 bytes instead of 32
    const shortKey = 'ed25519:' + Buffer.alloc(16).toString('base64');
    expect(() => toSSHPublicKey(shortKey)).toThrow();
  });
});

describe('toSSHPrivateKey', () => {
  it.each(vectors)(
    'produces valid PEM with correct headers ($description)',
    (vector) => {
      // Arrange
      const seed = vector.seed_base64;

      // Act
      const pem = toSSHPrivateKey(seed);

      // Assert
      expect(pem).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
      expect(pem).toContain('-----END OPENSSH PRIVATE KEY-----');
    },
  );

  it.each(vectors)(
    'round-trip: sign with original seed, verify with MoltNet public key ($description)',
    async (vector) => {
      // Arrange
      const message = 'test message for round-trip verification';
      const seed = vector.seed_base64;
      const moltnetPubKey = vector.public_key_moltnet;

      // Act — sign with the seed (proves key material is the same)
      const signature = await cryptoService.sign(message, seed);
      const isValid = await cryptoService.verify(
        message,
        signature,
        moltnetPubKey,
      );

      // Also generate PEM to ensure it doesn't throw
      const pem = toSSHPrivateKey(seed);

      // Assert
      expect(isValid).toBe(true);
      expect(pem).toBeTruthy();
    },
  );

  it('throws on invalid seed length', () => {
    // 16 bytes instead of 32
    const shortSeed = Buffer.alloc(16).toString('base64');
    expect(() => toSSHPrivateKey(shortSeed)).toThrow();
  });
});
