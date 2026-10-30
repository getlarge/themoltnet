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
  it('deploys final task authorization without diary-parent traversal', () => {
    const block = taskBlock('permissions.ts');
    expect(block).not.toContain('parent: Diary[]');
    expect(block).toContain("SubjectSet<Group, 'members'>");
    expect(block).toContain(
      'this.related.team.traverse((t) => t.permits.access(ctx))',
    );
    expect(block).toContain('this.related.writers.includes(ctx.subject)');
    expect(block).toContain('this.related.managers.includes(ctx.subject)');
    expect(block).toContain('this.related.claimant.includes(ctx.subject)');
    expect(block).not.toContain('this.related.parent');
  });
});
