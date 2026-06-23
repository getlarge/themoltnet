import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export function resolveLatestPiSessionPath(sessionDir: string): string | null {
  try {
    const latestEntry = readdirSync(sessionDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name)
      .sort()
      .at(-1);
    return latestEntry ? join(sessionDir, latestEntry) : null;
  } catch {
    return null;
  }
}
