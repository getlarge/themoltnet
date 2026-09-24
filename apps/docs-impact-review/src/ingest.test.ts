import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { boundDiff, collectChangeSet } from './ingest.js';
import { createTestRepo, type TestRepo } from './test-repo.js';

describe('collectChangeSet', () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('categorizes changed files and keeps every file in the manifest', () => {
    // Arrange
    const base = repo.commit({
      '.gitattributes': 'libs/api/generated/** linguist-generated=true\n',
      'apps/cli/src/flags.ts': 'export const a = 1;\n',
      'apps/cli/src/old-name.ts': 'export const moved = 1;\n'.repeat(20),
    });
    const head = repo.commit({
      'apps/cli/src/flags.ts': 'export const a = 2;\n',
      'apps/cli/src/flags.test.ts': 'it("x", () => {});\n',
      'docs/reference/cli.md': '# CLI\n',
      'apps/cli/README.md': '# cli\n',
      'libs/api/generated/client.ts': 'export {};\n',
      'libs/other/src/generated/types.gen.ts': 'export {};\n',
      'apps/cli/client_gen.go': 'package cli\n',
      'CHANGELOG.md': '## 1.0.0\n',
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      'assets/logo.png': Buffer.from([0, 1, 2, 3, 0, 255]),
      'apps/cli/src/old-name.ts': null,
      'apps/cli/src/new-name.ts': 'export const moved = 1;\n'.repeat(20),
    });

    // Act
    const changeSet = collectChangeSet(repo.git, base, head);

    // Assert
    const byPath = Object.fromEntries(
      changeSet.files.map((file) => [file.path, file]),
    );
    expect(byPath['apps/cli/src/flags.ts'].category).toBe('source');
    expect(byPath['apps/cli/src/flags.test.ts'].category).toBe('test');
    expect(byPath['docs/reference/cli.md'].category).toBe('docs');
    expect(byPath['apps/cli/README.md'].category).toBe('docs');
    expect(byPath['libs/api/generated/client.ts'].category).toBe('generated');
    expect(byPath['libs/other/src/generated/types.gen.ts'].category).toBe(
      'generated',
    );
    expect(byPath['apps/cli/client_gen.go'].category).toBe('generated');
    expect(byPath['CHANGELOG.md'].category).toBe('generated');
    expect(byPath['pnpm-lock.yaml'].category).toBe('generated');
    expect(byPath['assets/logo.png'].category).toBe('binary');
    expect(byPath['apps/cli/src/new-name.ts']).toMatchObject({
      status: 'renamed',
      previousPath: 'apps/cli/src/old-name.ts',
    });
    expect(changeSet.files).toHaveLength(11);
  });

  it('ignores generated declarations added by the reviewed head', () => {
    // Arrange
    const base = repo.commit({ 'src/public.ts': 'export const a = 1;\n' });
    const head = repo.commit({
      '.gitattributes': 'src/** linguist-generated=true\n',
      'src/public.ts': 'export const a = 2;\n',
    });

    // Act
    const changeSet = collectChangeSet(repo.git, base, head);

    // Assert
    expect(
      changeSet.files.find((file) => file.path === 'src/public.ts')?.category,
    ).toBe('source');
  });

  it('rejects abbreviated revisions', () => {
    // Arrange
    const base = repo.commit({ 'a.ts': '1' });

    // Act / Assert
    expect(() => collectChangeSet(repo.git, base.slice(0, 7), base)).toThrow(
      /full 40-character/,
    );
  });
});

describe('boundDiff', () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('includes source and docs patches and excludes tests and generated files', () => {
    // Arrange
    const base = repo.commit({ 'src/a.ts': 'export const a = 1;\n' });
    const head = repo.commit({
      'src/a.ts': 'export const a = 2;\n',
      'src/a.test.ts': 'test\n',
      'docs/a.md': '# A\n',
      'CHANGELOG.md': '## x\n',
    });
    const changeSet = collectChangeSet(repo.git, base, head);

    // Act
    const diff = boundDiff(repo.git, changeSet, {
      totalBytes: 10_000,
      perFileBytes: 5_000,
    });

    // Assert
    expect(diff.includedPaths.sort()).toEqual(['docs/a.md', 'src/a.ts']);
    expect(diff.text).toContain('### src/a.ts');
    expect(diff.text).toContain('+export const a = 2;');
    expect(diff.text).not.toContain('a.test.ts');
    expect(diff.omittedPaths).toEqual([]);
  });

  it('summarizes deleted files by header instead of their removed body', () => {
    // Arrange
    const base = repo.commit({
      'src/retired.ts': 'export const retired = 1;\n'.repeat(300),
    });
    const head = repo.commit({ 'src/retired.ts': null });
    const changeSet = collectChangeSet(repo.git, base, head);

    // Act
    const diff = boundDiff(repo.git, changeSet, {
      totalBytes: 10_000,
      perFileBytes: 5_000,
    });

    // Assert
    expect(diff.text).toBe('### src/retired.ts (deleted, -300 lines)\n\n');
    expect(diff.includedPaths).toEqual(['src/retired.ts']);
  });

  it('truncates oversized files and reports files dropped by the total budget', () => {
    // Arrange
    const base = repo.commit({ 'src/keep.ts': '', 'src/drop.ts': '' });
    const head = repo.commit({
      'src/keep.ts': 'export const big = 1;\n'.repeat(400),
      'src/drop.ts': 'export const other = 1;\n'.repeat(400),
    });
    const changeSet = collectChangeSet(repo.git, base, head);

    // Act
    const diff = boundDiff(repo.git, changeSet, {
      totalBytes: 1_500,
      perFileBytes: 1_000,
    });

    // Assert
    expect(diff.includedPaths).toHaveLength(1);
    expect(diff.truncatedPaths).toEqual(diff.includedPaths);
    expect(diff.omittedPaths).toHaveLength(1);
    expect(diff.text).toContain('[truncated');
    expect(diff.bytes).toBeLessThanOrEqual(1_500);
  });
});
