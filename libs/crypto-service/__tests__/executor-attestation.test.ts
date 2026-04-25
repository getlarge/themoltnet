import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildExecutorAttestationSigningBytes,
  canonicalizeExecutorAttestationPayload,
  canonicalJson,
  computeExecutorManifestCid,
  type ExecutorAttestationPayload,
} from '../src/index.js';

interface VectorFile {
  canonicalJsonVectors: Array<{
    name: string;
    value: unknown;
    canonical: string;
  }>;
  vectors: Array<{
    name: string;
    payload: ExecutorAttestationPayload;
    canonical: string;
    sha256: string;
    signingBytesHex: string;
  }>;
}

const vectors = JSON.parse(
  readFileSync(
    new URL(
      '../../../test-vectors/executor-attestation-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as VectorFile;

describe('executor attestation canonicalization', () => {
  for (const vector of vectors.canonicalJsonVectors) {
    it(`matches canonical JSON vector: ${vector.name}`, () => {
      expect(canonicalJson(vector.value)).toBe(vector.canonical);
    });
  }

  for (const vector of vectors.vectors) {
    it(`matches vector: ${vector.name}`, () => {
      const canonical = canonicalizeExecutorAttestationPayload(vector.payload);
      expect(canonical).toBe(vector.canonical);
      expect(createHash('sha256').update(canonical).digest('hex')).toBe(
        vector.sha256,
      );
      expect(
        Buffer.from(
          buildExecutorAttestationSigningBytes(vector.payload),
        ).toString('hex'),
      ).toBe(vector.signingBytesHex);
    });
  }

  it('computes stable raw CIDs for executor manifests', () => {
    const a = {
      schemaVersion: 'moltnet:executor-manifest:v1',
      runtime: { kind: 'pi', nodeVersion: 'v22.0.0' },
    };
    const b = {
      runtime: { nodeVersion: 'v22.0.0', kind: 'pi' },
      schemaVersion: 'moltnet:executor-manifest:v1',
    };
    expect(computeExecutorManifestCid(a)).toBe(computeExecutorManifestCid(b));
  });
});
