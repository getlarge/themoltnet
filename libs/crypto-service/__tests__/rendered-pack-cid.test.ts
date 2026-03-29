import { describe, expect, it } from 'vitest';

import { computeContentCid } from '../src/content-cid.js';
import { computePackCid, type PackEntryRef } from '../src/pack-cid.js';
import {
  buildRenderedPackEnvelope,
  computeContentHash,
  computeRenderedPackCid,
  type RenderedPackEnvelopeInput,
} from '../src/rendered-pack-cid.js';

function computeEntryLikeCid(label: string): string {
  return computeContentCid('semantic', label, `Content for ${label}`, ['test']);
}

function makeSourcePackCid(): string {
  const entries: PackEntryRef[] = [
    { cid: computeEntryLikeCid('entry-1'), compressionLevel: 'full', rank: 1 },
  ];
  return computePackCid({
    diaryId: 'diary-uuid',
    packType: 'compile',
    params: { tokenBudget: 4096 },
    entries,
  });
}

const FIXTURE_SOURCE_CID = makeSourcePackCid();

const FIXTURE_INPUT: RenderedPackEnvelopeInput = {
  sourcePackCid: FIXTURE_SOURCE_CID,
  renderMethod: 'pack-to-docs-v1',
  contentHash:
    'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
};

describe('rendered-pack-cid', () => {
  describe('computeContentHash', () => {
    it('produces a 64-character hex SHA-256 digest', () => {
      const hash = computeContentHash('# Hello World\n');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic', () => {
      const a = computeContentHash('same content');
      const b = computeContentHash('same content');
      expect(a).toBe(b);
    });

    it('changes when content changes', () => {
      const a = computeContentHash('version 1');
      const b = computeContentHash('version 2');
      expect(a).not.toBe(b);
    });
  });

  describe('buildRenderedPackEnvelope', () => {
    it('produces deterministic bytes', () => {
      const a = buildRenderedPackEnvelope(FIXTURE_INPUT);
      const b = buildRenderedPackEnvelope(FIXTURE_INPUT);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    });

    it('changes when renderMethod changes', () => {
      const a = buildRenderedPackEnvelope(FIXTURE_INPUT);
      const b = buildRenderedPackEnvelope({
        ...FIXTURE_INPUT,
        renderMethod: 'agent-refined-v2',
      });
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    });
  });

  describe('computeRenderedPackCid', () => {
    it('produces a CIDv1 string starting with bafyr', () => {
      const cid = computeRenderedPackCid(FIXTURE_INPUT);
      expect(cid).toMatch(/^bafyr/);
    });

    it('is deterministic', () => {
      const a = computeRenderedPackCid(FIXTURE_INPUT);
      const b = computeRenderedPackCid(FIXTURE_INPUT);
      expect(a).toBe(b);
    });

    it('changes when contentHash changes', () => {
      const a = computeRenderedPackCid(FIXTURE_INPUT);
      const b = computeRenderedPackCid({
        ...FIXTURE_INPUT,
        contentHash:
          'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      });
      expect(a).not.toBe(b);
    });

    it('changes when sourcePackCid changes', () => {
      // Build a different source pack CID
      const entries: PackEntryRef[] = [
        {
          cid: computeEntryLikeCid('entry-2'),
          compressionLevel: 'full',
          rank: 1,
        },
      ];
      const differentSourceCid = computePackCid({
        diaryId: 'diary-uuid-2',
        packType: 'compile',
        params: { tokenBudget: 8192 },
        entries,
      });

      const a = computeRenderedPackCid(FIXTURE_INPUT);
      const b = computeRenderedPackCid({
        ...FIXTURE_INPUT,
        sourcePackCid: differentSourceCid,
      });
      expect(a).not.toBe(b);
    });

    it('differs from source pack CID', () => {
      const renderedCid = computeRenderedPackCid(FIXTURE_INPUT);
      expect(renderedCid).not.toBe(FIXTURE_SOURCE_CID);
    });
  });
});
