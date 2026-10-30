/**
 * Cross-Language Crypto Test Vectors
 *
 * Loads test-fixtures/crypto-vectors.json and verifies that the JS
 * crypto-service produces identical outputs to what the Go CLI expects.
 * The Go CLI has its own test loading the same file.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cryptoService } from '../src/crypto.service.js';

interface Vector {
  comment: string;
  private_key_base64: string;
  public_key: string;
  fingerprint: string;
  sign_input: string;
  signature_base64: string;
}

const vectorsPath = resolve(
  import.meta.dirname,
  '../../../test-fixtures/crypto-vectors.json',
);
const { vectors } = JSON.parse(readFileSync(vectorsPath, 'utf-8')) as {
  vectors: Vector[];
};

describe('Cross-language crypto vectors', () => {
  for (const [i, v] of vectors.entries()) {
    describe(`vector ${i + 1}: ${v.comment}`, () => {
      it('derives expected public key from seed', async () => {
        const derived = await cryptoService.derivePublicKey(
          v.private_key_base64,
        );
        expect(derived).toBe(v.public_key);
      });

      it('computes expected fingerprint', () => {
        const fp = cryptoService.getFingerprintFromPublicKey(v.public_key);
        expect(fp).toBe(v.fingerprint);
      });

      it('produces expected signature', async () => {
        const sig = await cryptoService.sign(
          v.sign_input,
          v.private_key_base64,
        );
        expect(sig).toBe(v.signature_base64);
      });

      it('verifies the expected signature', async () => {
        const valid = await cryptoService.verify(
          v.sign_input,
          v.signature_base64,
          v.public_key,
        );
        expect(valid).toBe(true);
      });
    });
  }
});
