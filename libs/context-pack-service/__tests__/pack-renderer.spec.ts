import { describe, expect, it } from 'vitest';

import {
  type RenderablePackEntry,
  renderPackToMarkdown,
} from '../src/pack-renderer.js';

function makeEntry(
  overrides?: Partial<RenderablePackEntry>,
): RenderablePackEntry {
  return {
    entryId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    entryCidSnapshot: 'bafyreig...',
    compressionLevel: 'full',
    originalTokens: 100,
    packedTokens: 100,
    rank: 1,
    entry: {
      title: 'Authentication middleware',
      content: 'JWT validation uses RS256 with Ory-issued tokens.',
    },
    ...overrides,
  };
}

describe('renderPackToMarkdown', () => {
  it('renders a pack header with entry count and creation date', () => {
    const md = renderPackToMarkdown({
      packId: 'pack-uuid',
      createdAt: '2026-03-29T12:00:00Z',
      entries: [makeEntry()],
    });
    expect(md).toContain('# Context Pack pack-uuid');
    expect(md).toContain('Entries: 1');
    expect(md).toContain('2026-03-29T12:00:00Z');
  });

  it('renders each entry with title, CID, compression, and content', () => {
    const md = renderPackToMarkdown({
      packId: 'p',
      createdAt: '2026-01-01T00:00:00Z',
      entries: [makeEntry()],
    });
    expect(md).toContain('### Authentication middleware');
    expect(md).toContain('- Entry ID: `a1b2c3d4');
    expect(md).toContain('- CID: `bafyreig...`');
    expect(md).toContain('- Compression: `full`');
    expect(md).toContain('- Tokens: 100/100');
    expect(md).toContain('JWT validation uses RS256');
  });

  it('uses fallback title when entry has no title', () => {
    const md = renderPackToMarkdown({
      packId: 'p',
      createdAt: '2026-01-01T00:00:00Z',
      entries: [makeEntry({ entry: { title: null, content: 'Some content' } })],
    });
    expect(md).toMatch(/### Entry 1/);
  });

  it('renders entries in rank order', () => {
    const md = renderPackToMarkdown({
      packId: 'p',
      createdAt: '2026-01-01T00:00:00Z',
      entries: [
        makeEntry({ rank: 2, entry: { title: 'Second', content: '...' } }),
        makeEntry({ rank: 1, entry: { title: 'First', content: '...' } }),
      ],
    });
    const firstPos = md.indexOf('### First');
    const secondPos = md.indexOf('### Second');
    expect(firstPos).toBeLessThan(secondPos);
  });

  it('handles null token values gracefully', () => {
    const md = renderPackToMarkdown({
      packId: 'p',
      createdAt: '2026-01-01T00:00:00Z',
      entries: [makeEntry({ originalTokens: null, packedTokens: null })],
    });
    expect(md).toContain('- Tokens: ?/?');
  });
});
