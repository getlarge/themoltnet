import { describe, expect, it } from 'vitest';

import { extractExcerpt } from './sections.js';

const doc = [
  '# Tool',
  'Intro text.',
  '## Install',
  'Run the installer.',
  '## Flags',
  'Use `--dry-run` to preview.',
  '### Advanced',
  'Nothing relevant.',
].join('\n');

describe('extractExcerpt', () => {
  it('keeps the outline and only the sections that mention a term', () => {
    // Act
    const excerpt = extractExcerpt(doc, ['--dry-run'], 4_000);

    // Assert
    expect(excerpt).toContain('Outline:\n- # Tool\n- ## Install');
    expect(excerpt).toContain('Use `--dry-run` to preview.');
    expect(excerpt).not.toContain('Run the installer.');
  });

  it('falls back to the first section when no term matches', () => {
    // Act
    const excerpt = extractExcerpt(doc, ['MISSING'], 4_000);

    // Assert
    expect(excerpt).toContain('Intro text.');
    expect(excerpt).not.toContain('--dry-run');
  });

  it('stays within the byte budget', () => {
    // Arrange
    const large = `# Big\n${'--dry-run filler line\n'.repeat(1_000)}`;

    // Act
    const excerpt = extractExcerpt(large, ['--dry-run'], 2_000);

    // Assert
    expect(Buffer.byteLength(excerpt, 'utf8')).toBeLessThanOrEqual(2_000);
    expect(excerpt).toContain('[truncated');
  });
});
