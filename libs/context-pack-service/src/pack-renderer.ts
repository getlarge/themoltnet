export interface RenderablePackEntry {
  entryId: string;
  entryCidSnapshot: string;
  compressionLevel: string;
  originalTokens: number | null;
  packedTokens: number | null;
  rank: number | null;
  entry: {
    title: string | null;
    content: string;
  };
}

export interface RenderablePackInput {
  packId: string;
  createdAt: string;
  entries: RenderablePackEntry[];
}

/**
 * Render a context pack to a human-readable markdown document.
 *
 * The output includes a header with pack metadata,
 * followed by each entry rendered as a section with title, CID,
 * compression level, token counts, and content.
 */
export function renderPackToMarkdown(input: RenderablePackInput): string {
  const sorted = [...input.entries].sort(
    (a, b) =>
      (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER),
  );
  const lines: string[] = [];

  lines.push(`# Context Pack ${input.packId}`);
  lines.push('');
  lines.push(`- Created: ${input.createdAt}`);
  lines.push(`- Entries: ${sorted.length}`);
  lines.push('');

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const heading = entry.entry.title ?? `Entry ${i + 1}`;
    lines.push(`### ${heading}`);
    lines.push('');
    lines.push(`- Entry ID: \`${entry.entryId}\``);
    lines.push(`- CID: \`${entry.entryCidSnapshot}\``);
    lines.push(`- Compression: \`${entry.compressionLevel}\``);
    lines.push(
      `- Tokens: ${entry.packedTokens ?? '?'}/${entry.originalTokens ?? '?'}`,
    );
    lines.push('');
    lines.push(entry.entry.content);
    lines.push('');
  }

  return lines.join('\n');
}
