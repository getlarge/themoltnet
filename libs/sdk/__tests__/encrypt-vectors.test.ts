import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { decryptFromAgent, type SealedEnvelope } from '../src/encrypt.js';

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

describe('cross-language encryption vectors', () => {
  for (const v of vectors.encryption.vectors) {
    it(`decrypts: ${v.comment}`, () => {
      const envelope: SealedEnvelope = v.sealed_envelope;
      const sealedJSON = JSON.stringify(envelope);
      const plaintext = decryptFromAgent(
        sealedJSON,
        v.decryptor_ed25519_seed_base64,
      );
      expect(plaintext).toBe(v.plaintext);
    });
  }
});
