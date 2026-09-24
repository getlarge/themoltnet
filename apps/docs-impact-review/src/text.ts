/** Cuts `text` to at most `maxBytes` UTF-8 bytes at a line boundary. */
export function truncateAtLine(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) return text;
  const marker = (dropped: number) => `[truncated ${dropped} bytes]\n`;
  // Reserve room for the marker so the result honors the budget.
  const room = Math.max(
    0,
    maxBytes - Buffer.byteLength(marker(buffer.byteLength)),
  );
  const cut = buffer.subarray(0, room).toString('utf8');
  const lastNewline = cut.lastIndexOf('\n');
  const kept = lastNewline > 0 ? cut.slice(0, lastNewline + 1) : '';
  return `${kept}${marker(buffer.byteLength - Buffer.byteLength(kept, 'utf8'))}`;
}
