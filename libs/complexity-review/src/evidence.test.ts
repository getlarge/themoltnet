import { describe, expect, it } from 'vitest';

import { buildDomainWork, buildEvidence, MAX_PATCH_BYTES } from './evidence.js';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
function evidenceFor(files: Array<{ path: string; patch: string }>) {
  return buildEvidence(
    (args) =>
      args.includes('--name-only')
        ? files.map((file) => file.path).join('\0') + '\0'
        : args.includes('--stat')
          ? `${files.length} files changed`
          : files
              .map(
                (file) =>
                  `diff --git a/${file.path} b/${file.path}\n${file.patch}`,
              )
              .join(''),
    base,
    head,
  );
}
function packetize(evidence: ReturnType<typeof buildEvidence>) {
  return buildDomainWork(
    [
      {
        id: 'changes',
        nature: 'all changes',
        paths: evidence.files.map((file) => file.path),
      },
    ],
    evidence,
  );
}

describe('complexity evidence packets', () => {
  it('summarizes an oversized nested lockfile deletion while preserving its status and size', () => {
    const evidence = evidenceFor([
      {
        path: 'examples/custom-pi-runtime/pnpm-lock.yaml',
        patch:
          'deleted file mode 100644\n--- a/examples/custom-pi-runtime/pnpm-lock.yaml\n+++ /dev/null\n@@ -1,10000 +0,0 @@\n' +
          '-dependency: 1\n'.repeat(10000),
      },
    ]);
    const file = evidence.files[0];
    expect(file.summarized).toBe(true);
    expect(file.patch).toContain('deleted file mode 100644');
    expect(file.patch).toContain('10000 deleted lines');
    expect(file.patch).toContain('Lockfile contents are not reviewed');
    expect(file.patch).not.toContain('-dependency: 1');
    expect(file.bytes).toBeLessThan(1000);
    expect(packetize(evidence)).toHaveLength(1);
  });

  it('summarizes lockfile modifications with both additions and deletions', () => {
    const evidence = evidenceFor([
      {
        path: 'pnpm-lock.yaml',
        patch:
          '--- a/pnpm-lock.yaml\n+++ b/pnpm-lock.yaml\n@@ -1 +1 @@\n-old\n+new\n',
      },
    ]);
    expect(evidence.files[0].patch).toContain('1 added lines, 1 deleted lines');
  });

  it('preserves every byte of an oversized multibyte source patch, even across a huge line', () => {
    const evidence = evidenceFor([
      {
        path: 'src/large.ts',
        patch: '@@ -1 +1 @@\n+' + '🙂'.repeat(MAX_PATCH_BYTES) + '\n+tail\n',
      },
    ]);
    const work = packetize(evidence);
    const chunks = work.flatMap((item) => item.files);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((file) => file.patch).join('')).toBe(
      evidence.files[0].patch,
    );
    expect(chunks.every((file) => !file.patch.includes('�'))).toBe(true);
    expect(
      work.every(
        (item) =>
          item.files.reduce((sum, file) => sum + file.bytes, 0) <=
          MAX_PATCH_BYTES,
      ),
    ).toBe(true);
    expect(chunks.map((file) => file.segment)).toEqual(
      chunks.map((_, index) => ({ index: index + 1, total: chunks.length })),
    );
    expect(chunks.every((file) => !file.summarized)).toBe(true);
  });

  it('keeps line-aligned segments of the same path in distinct validated packets', () => {
    const evidence = evidenceFor([
      {
        path: 'large.ts',
        patch: ('+' + 'x'.repeat(49000) + '\n').repeat(4) + '+tail\n',
      },
    ]);
    const work = packetize(evidence);
    expect(work.length).toBeGreaterThan(2);
    expect(
      work.every(
        (item) =>
          new Set(item.files.map((file) => file.path)).size ===
          item.files.length,
      ),
    ).toBe(true);
    expect(
      work
        .flatMap((item) => item.files)
        .map((file) => file.patch)
        .join(''),
    ).toBe(evidence.files[0].patch);
  });

  it('reviews more than 120 changed files and more than eight packets', () => {
    const evidence = evidenceFor(
      Array.from({ length: 131 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        patch: '+' + 'x'.repeat(7000) + '\n',
      })),
    );
    expect(evidence.files).toHaveLength(131);
    const work = packetize(evidence);
    expect(work.length).toBeGreaterThan(8);
    expect(work.flatMap((item) => item.files).map((file) => file.path)).toEqual(
      evidence.files.map((file) => file.path),
    );
    expect(
      work.every(
        (item) =>
          item.files.reduce((sum, file) => sum + file.bytes, 0) <=
          MAX_PATCH_BYTES,
      ),
    ).toBe(true);
  });
});
