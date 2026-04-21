import { describe, expect, it } from 'vitest';

import {
  type ExpandedPack,
  type PackEntry,
  renderPhase6Markdown,
} from './render-phase6.js';

function makeEntry(overrides: Partial<PackEntry> = {}): PackEntry {
  return {
    entryId: '11111111-aaaa-bbbb-cccc-222222222222',
    entryCidSnapshot: 'bafycid0001',
    compressionLevel: 'full',
    originalTokens: 100,
    packedTokens: 100,
    entry: {
      title: 'Use absolute paths for gitconfig credentials',
      content:
        '<metadata>ignored</metadata>\nMUST resolve moltnet.json via absolute path.\nWatch for: relative GIT_CONFIG_GLOBAL.\n',
      tags: ['scope:legreffier-gh', 'severity:high', 'accountability'],
      entryType: 'semantic',
      creator: {
        fingerprint: 'abcd-efgh-ijkl-mnop',
      },
    },
    ...overrides,
  };
}

function makePack(entries: PackEntry[]): ExpandedPack {
  return {
    id: 'pack-uuid-1',
    packCid: 'bafypackcid',
    createdAt: '2026-04-01T00:00:00Z',
    entries,
  };
}

describe('renderPhase6Markdown', () => {
  it('renders a Source header with pack metadata', () => {
    const md = renderPhase6Markdown(makePack([makeEntry()]));
    expect(md).toContain('# Rendered Pack');
    expect(md).toContain('| `pack-uuid-1` | `bafypackcid` | 1 |');
  });

  it('groups entries by scope and emits section headings', () => {
    const md = renderPhase6Markdown(
      makePack([
        makeEntry({
          entryId: 'a',
          entry: {
            ...makeEntry().entry,
            title: 'A',
            tags: ['scope:auth'],
          },
        }),
        makeEntry({
          entryId: 'b',
          entry: {
            ...makeEntry().entry,
            title: 'B',
            tags: ['scope:rendering'],
          },
        }),
      ]),
    );

    expect(md).toContain('## Auth');
    expect(md).toContain('## Rendering');
  });

  it('extracts rule-like lines into a Rules block', () => {
    const md = renderPhase6Markdown(makePack([makeEntry()]));
    expect(md).toContain('**Rules**');
    expect(md).toMatch(/- MUST resolve moltnet.json via absolute path/);
  });

  it('strips <metadata> scaffolding from content', () => {
    const md = renderPhase6Markdown(makePack([makeEntry()]));
    expect(md).not.toContain('<metadata>');
    expect(md).not.toContain('ignored');
  });

  it('shows provenance block with entry id and CID', () => {
    const md = renderPhase6Markdown(makePack([makeEntry()]));
    expect(md).toContain('Provenance:');
    expect(md).toContain('`11111111-aaaa-bbbb-cccc-222222222222`');
    expect(md).toContain('`bafycid0001`');
  });

  it('unwraps signed envelopes, keeping only the inner content body', () => {
    const signedContent = [
      '<moltnet-signed>',
      '<content>',
      'Fix: compute contentHash for ALL entries at creation time.',
      '</content>',
      '<metadata>',
      'signer: 1671-B080-99BF-4270',
      'tool: claude',
      '</metadata>',
      '<signature>oTeWu3sL4cuobP+wgCPTcZgbBASmQxPXblFDLKXPLZllk8fGuCpg8yg4LT7Bg7qJZswQKfDmUZvB0E80ncW1Cg==</signature>',
      '</moltnet-signed>',
    ].join('\n');

    const md = renderPhase6Markdown(
      makePack([
        makeEntry({
          entry: {
            ...makeEntry().entry,
            title: 'Bug fix: contentHash',
            content: signedContent,
          },
        }),
      ]),
    );

    expect(md).toContain('Fix: compute contentHash for ALL entries');
    expect(md).not.toContain('<moltnet-signed>');
    expect(md).not.toContain('<content>');
    expect(md).not.toContain('</content>');
    expect(md).not.toContain('<signature>');
    expect(md).not.toContain(
      'oTeWu3sL4cuobP+wgCPTcZgbBASmQxPXblFDLKXPLZllk8fGuCpg8yg4LT7Bg7qJZswQKfDmUZvB0E80ncW1Cg==',
    );
    expect(md).not.toContain('signer: 1671-B080-99BF-4270');
  });

  it('removes orphaned signature blocks on malformed signed entries', () => {
    const malformed = [
      'Some prose about the fix.',
      '<signature>abc123==</signature>',
      'More prose.',
    ].join('\n');

    const md = renderPhase6Markdown(
      makePack([
        makeEntry({
          entry: {
            ...makeEntry().entry,
            content: malformed,
          },
        }),
      ]),
    );

    expect(md).toContain('Some prose about the fix.');
    expect(md).toContain('More prose.');
    expect(md).not.toContain('<signature>');
    expect(md).not.toContain('abc123==');
  });

  it('handles empty packs gracefully', () => {
    const md = renderPhase6Markdown(makePack([]));
    expect(md).toContain('_This pack has no expanded entries._');
  });
});
