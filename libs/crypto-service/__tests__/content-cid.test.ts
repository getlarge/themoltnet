import { describe, expect, it } from 'vitest';

import { computeCanonicalHash, computeContentCid } from '../src/content-cid.js';

describe('computeCanonicalHash', () => {
  it('produces deterministic output for the same input', () => {
    const hash1 = computeCanonicalHash('semantic', 'Title', 'Content', [
      'tag1',
    ]);
    const hash2 = computeCanonicalHash('semantic', 'Title', 'Content', [
      'tag1',
    ]);
    expect(hash1).toEqual(hash2);
  });

  it('produces different output for different content', () => {
    const hash1 = computeCanonicalHash('semantic', 'Title', 'Content A', null);
    const hash2 = computeCanonicalHash('semantic', 'Title', 'Content B', null);
    expect(hash1).not.toEqual(hash2);
  });

  it('handles null title', () => {
    const hash1 = computeCanonicalHash('semantic', null, 'Content', null);
    const hash2 = computeCanonicalHash('semantic', undefined, 'Content', null);
    expect(hash1).toEqual(hash2);
  });

  it('handles null tags', () => {
    const hash1 = computeCanonicalHash('semantic', 'T', 'Content', null);
    const hash2 = computeCanonicalHash('semantic', 'T', 'Content', undefined);
    expect(hash1).toEqual(hash2);
  });

  it('sorts tags for determinism', () => {
    const hash1 = computeCanonicalHash('semantic', 'T', 'C', ['beta', 'alpha']);
    const hash2 = computeCanonicalHash('semantic', 'T', 'C', ['alpha', 'beta']);
    expect(hash1).toEqual(hash2);
  });

  it('returns 32-byte SHA-256 hash', () => {
    const hash = computeCanonicalHash('semantic', null, 'test', null);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });
});

describe('computeContentCid', () => {
  it('produces a CIDv1 string starting with "bafk"', () => {
    const cid = computeContentCid('semantic', 'Title', 'Content', ['tag1']);
    expect(cid).toMatch(/^bafk/);
  });

  it('is deterministic', () => {
    const cid1 = computeContentCid('reflection', null, 'My thought', [
      'philosophy',
    ]);
    const cid2 = computeContentCid('reflection', null, 'My thought', [
      'philosophy',
    ]);
    expect(cid1).toBe(cid2);
  });

  it('changes when any field changes', () => {
    const base = {
      type: 'semantic' as const,
      title: 'Title',
      content: 'Content',
      tags: ['tag1'],
    };
    const cidBase = computeContentCid(
      base.type,
      base.title,
      base.content,
      base.tags,
    );

    // Different entry type
    expect(
      computeContentCid('identity', base.title, base.content, base.tags),
    ).not.toBe(cidBase);

    // Different title
    expect(
      computeContentCid(base.type, 'Other', base.content, base.tags),
    ).not.toBe(cidBase);

    // Different content
    expect(
      computeContentCid(base.type, base.title, 'Other', base.tags),
    ).not.toBe(cidBase);

    // Different tags
    expect(
      computeContentCid(base.type, base.title, base.content, ['tag2']),
    ).not.toBe(cidBase);
  });

  it('handles empty tags array same as null', () => {
    const cid1 = computeContentCid('semantic', null, 'Content', []);
    const cid2 = computeContentCid('semantic', null, 'Content', null);
    // Empty array produces "" sorted tags, null also produces "" — should match
    expect(cid1).toBe(cid2);
  });
});
