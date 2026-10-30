import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { cryptoService } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vectorsPath = join(
  __dirname,
  '..',
  '..',
  '..',
  'test-fixtures',
  'x25519-vectors.json',
);
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf-8'));

describe('cross-language X25519 derivation vectors', () => {
  for (const v of vectors.x25519_derivation.vectors) {
    describe(v.comment, () => {
      it('derives correct X25519 private key', () => {
        const got = cryptoService.deriveX25519PrivateKey(v.ed25519_seed_base64);
        expect(got).toBe(v.x25519_private_key_base64);
      });

      it('derives correct X25519 public key', () => {
        const got = cryptoService.deriveX25519PublicKey(v.ed25519_public_key);
        expect(got).toBe(`x25519:${v.x25519_public_key_base64}`);
      });
    });
  }
});
