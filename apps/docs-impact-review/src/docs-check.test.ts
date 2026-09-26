import { describe, expect, it } from 'vitest';

import { docsCheckFindings, extractDocsHunks } from './docs-check.js';
import type { DiffBlock } from './types.js';

const LIMITS = { maxHunks: 12, maxBytesPerHunk: 1_500 };

function docsBlock(path: string, body: string): DiffBlock {
  return {
    path,
    category: 'docs',
    text: `### ${path} (modified)\n${body}\n`,
  };
}

describe('extractDocsHunks', () => {
  it('collects added text per hunk with the nearest heading', () => {
    // Arrange: the shape of PR #2509's docs change.
    const block = docsBlock(
      'docs/reference/agent-configuration.md',
      [
        '@@ -443,6 +443,12 @@',
        ' ## Secret guard',
        ' absolute activation paths share one runtime boundary.',
        ' ',
        '+Plain CLI help calls such as `moltnet register --help` are',
        '+allowed because they cannot execute the credential operation.',
        '+',
        ' ## Identity files and network alias',
      ].join('\n'),
    );

    // Act
    const { hunks } = extractDocsHunks([block], LIMITS);

    // Assert
    expect(hunks).toEqual([
      {
        id: 'docs/reference/agent-configuration.md#1',
        path: 'docs/reference/agent-configuration.md',
        section: '## Secret guard',
        added:
          'Plain CLI help calls such as `moltnet register --help` are\nallowed because they cannot execute the credential operation.',
      },
    ]);
  });

  it('skips removal-only hunks and non-docs blocks', () => {
    // Arrange
    const blocks: DiffBlock[] = [
      docsBlock('docs/a.md', '@@ -1,2 +1,1 @@\n-old line\n kept'),
      {
        path: 'src/a.ts',
        category: 'source',
        text: '### src/a.ts (modified)\n@@ -1 +1 @@\n+x',
      },
    ];

    // Act / Assert
    expect(extractDocsHunks(blocks, LIMITS).hunks).toEqual([]);
  });

  it('reports hunks beyond the cap instead of dropping them silently', () => {
    // Arrange
    const body = Array.from(
      { length: 3 },
      (_, i) => `@@ -${i},1 +${i},2 @@\n+added ${i}`,
    ).join('\n');

    // Act
    const result = extractDocsHunks([docsBlock('docs/a.md', body)], {
      maxHunks: 2,
      maxBytesPerHunk: 100,
    });

    // Assert
    expect(result.hunks.map((hunk) => hunk.id)).toEqual([
      'docs/a.md#1',
      'docs/a.md#2',
    ]);
    expect(result.overflow).toEqual(['docs/a.md#3']);
  });
});

describe('docsCheckFindings', () => {
  const hunks = [
    { id: 'docs/a.md#1', path: 'docs/a.md', section: '## A', added: 'x' },
    { id: 'docs/a.md#2', path: 'docs/a.md', added: 'y' },
    { id: 'docs/b.md#1', path: 'docs/b.md', added: 'z' },
  ];

  it('turns remove and rewrite verdicts into unnecessary findings', () => {
    // Act
    const result = docsCheckFindings(hunks, [
      {
        id: 'docs/a.md#1',
        verdict: 'remove',
        reason: 'Only exists because a bug was fixed.',
      },
      { id: 'docs/a.md#2', verdict: 'keep', reason: 'Describes a setting.' },
      {
        id: 'docs/b.md#1',
        verdict: 'rewrite',
        reason: 'Phrased relative to the old behavior.',
      },
    ]);

    // Assert
    expect(result.unanswered).toEqual([]);
    expect(result.findings).toEqual([
      {
        changeId: 'docs:docs/a.md',
        issue: 'unnecessary',
        evidence: {
          path: 'docs/a.md',
          detail: 'Only exists because a bug was fixed.',
        },
        docsPath: 'docs/a.md',
        section: '## A',
        update: 'Remove this addition: Only exists because a bug was fixed.',
      },
      expect.objectContaining({
        docsPath: 'docs/b.md',
        update: 'Rewrite this addition: Phrased relative to the old behavior.',
      }),
    ]);
  });

  it('returns hunks the model did not judge', () => {
    // Act
    const result = docsCheckFindings(hunks, [
      { id: 'docs/a.md#1', verdict: 'keep', reason: 'fine' },
    ]);

    // Assert
    expect(result.unanswered).toEqual(['docs/a.md#2', 'docs/b.md#1']);
  });
});
