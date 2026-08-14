import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function taskBlock(file: string): string {
  const source = readFileSync(
    fileURLToPath(new URL(`../../infra/ory/${file}`, import.meta.url)),
    'utf8',
  );
  const start = source.indexOf('class Task implements Namespace');
  const end = source.indexOf('/**\n * Agent namespace', start);
  if (start === -1 || end === -1)
    throw new Error(`Task OPL block missing in ${file}`);
  return source.slice(start, end);
}

describe('task ownership OPL artifacts', () => {
  it('keeps parent only as provenance in the final model', () => {
    const block = taskBlock('permissions.ts');
    expect(block).toContain('parent: Diary[]');
    expect(block).not.toContain('this.related.parent');
    expect(block).toContain("SubjectSet<Group, 'members'>");
  });

  it('keeps the legacy parent fallback in the rollback bridge', () => {
    const block = taskBlock('permissions.bridge.ts');
    expect(block).toContain(
      'this.related.parent.traverse((d) => d.permits.read(ctx))',
    );
    expect(block).toContain(
      'this.related.parent.traverse((d) => d.permits.write(ctx))',
    );
    expect(block).toContain(
      'this.related.parent.traverse((d) => d.permits.manage(ctx))',
    );
    expect(block.match(/this\.related\.parent/g)?.length).toBe(7);
  });
});
