import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGit } from './git.js';
import { boundDiff, collectChangeSet } from './ingest.js';
import { createTestRepo, type TestRepo } from './test-repo.js';

const NO_DOCS_GLOBS = { include: [], exclude: [] };

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
    const changeSet = collectChangeSet(repo.git, base, head, NO_DOCS_GLOBS);

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

  it('treats a deleted Markdown file under an exclusion as generated', () => {
    // Arrange
    const base = repo.commit({ 'vendor/lib/README.md': '# vendored\n' });
    const head = repo.commit({ 'vendor/lib/README.md': null });

    // Act
    const changeSet = collectChangeSet(repo.git, base, head, {
      include: [],
      exclude: ['vendor/**'],
    });

    // Assert
    expect(changeSet.files).toMatchObject([
      {
        path: 'vendor/lib/README.md',
        status: 'deleted',
        category: 'generated',
      },
    ]);
  });

  it('treats Markdown matching the repository exclusions as generated', () => {
    // Arrange
    const base = repo.commit({ 'README.md': '# x\n' });
    const head = repo.commit({
      'vendor/lib/README.md': '# vendored\n',
      'docs/guide.md': '# guide\n',
    });

    // Act
    const changeSet = collectChangeSet(repo.git, base, head, {
      include: [],
      exclude: ['vendor/**'],
    });

    // Assert
    expect(
      Object.fromEntries(
        changeSet.files.map(({ path, category }) => [path, category]),
      ),
    ).toEqual({ 'vendor/lib/README.md': 'generated', 'docs/guide.md': 'docs' });
  });

  it('ignores generated declarations added by the reviewed head', () => {
    // Arrange
    const base = repo.commit({ 'src/public.ts': 'export const a = 1;\n' });
    const head = repo.commit({
      '.gitattributes': 'src/** linguist-generated=true\n',
      'src/public.ts': 'export const a = 2;\n',
    });

    // Act
    const changeSet = collectChangeSet(repo.git, base, head, NO_DOCS_GLOBS);

    // Assert
    expect(
      changeSet.files.find((file) => file.path === 'src/public.ts')?.category,
    ).toBe('source');
  });

  it('categorizes files the repository includes as documentation', () => {
    // Arrange
    const base = repo.commit({ 'src/a.ts': 'export const a = 1;\n' });
    const head = repo.commit({
      'docs/guide.rst': 'Guide\n=====\n',
      'docs/generated/api.rst': 'API\n===\n',
      'notes.txt': 'not docs\n',
    });

    // Act
    const changeSet = collectChangeSet(repo.git, base, head, {
      include: ['docs/**/*.rst'],
      exclude: ['docs/generated/**'],
    });

    // Assert: exclusions apply to included formats as they do to Markdown.
    expect(
      Object.fromEntries(
        changeSet.files.map((entry) => [entry.path, entry.category]),
      ),
    ).toEqual({
      'docs/generated/api.rst': 'generated',
      'docs/guide.rst': 'docs',
      'notes.txt': 'source',
    });
  });

  it('rejects abbreviated revisions', () => {
    // Arrange
    const base = repo.commit({ 'a.ts': '1' });

    // Act / Assert
    expect(() =>
      collectChangeSet(repo.git, base.slice(0, 7), base, NO_DOCS_GLOBS),
    ).toThrow(/full 40-character/);
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
    const changeSet = collectChangeSet(repo.git, base, head, NO_DOCS_GLOBS);

    // Act
    const diff = boundDiff(repo.git, changeSet, {
      totalBytes: 10_000,
      perFileBytes: 5_000,
      docsReserveBytes: 0,
      prioritySources: [],
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
    const changeSet = collectChangeSet(repo.git, base, head, NO_DOCS_GLOBS);

    // Act
    const diff = boundDiff(repo.git, changeSet, {
      totalBytes: 10_000,
      perFileBytes: 5_000,
      docsReserveBytes: 0,
      prioritySources: [],
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
    const changeSet = collectChangeSet(repo.git, base, head, NO_DOCS_GLOBS);

    // Act
    const diff = boundDiff(repo.git, changeSet, {
      totalBytes: 1_500,
      perFileBytes: 1_000,
      docsReserveBytes: 0,
      prioritySources: [],
    });

    // Assert
    expect(diff.includedPaths).toHaveLength(1);
    expect(diff.truncatedPaths).toEqual(diff.includedPaths);
    expect(diff.omittedPaths).toHaveLength(1);
    expect(diff.text).toContain('[truncated');
    expect(diff.bytes).toBeLessThanOrEqual(1_500);
  });

  it('keeps changed docs within their reserve when source fills the budget', () => {
    // Arrange
    const base = repo.commit({ 'README.md': '', 'src/big.ts': '' });
    const head = repo.commit({
      'README.md': 'Run `tool --new`.\n',
      'src/big.ts': 'export const big = 1;\n'.repeat(400),
    });
    const changeSet = collectChangeSet(repo.git, base, head, NO_DOCS_GLOBS);

    // Act
    const withoutReserve = boundDiff(repo.git, changeSet, {
      totalBytes: 2_000,
      perFileBytes: 2_000,
      docsReserveBytes: 0,
      prioritySources: [],
    });
    const withReserve = boundDiff(repo.git, changeSet, {
      totalBytes: 2_000,
      perFileBytes: 2_000,
      docsReserveBytes: 500,
      prioritySources: [],
    });

    // Assert: a per-file cap equal to the total truncates the source patch
    // (header included) rather than omitting it, so it crowds the docs out
    // without a reserve; the reserve keeps them and drops the source.
    expect(withoutReserve.includedPaths).toEqual(['src/big.ts']);
    expect(withoutReserve.truncatedPaths).toEqual(['src/big.ts']);
    expect(withoutReserve.bytes).toBeLessThanOrEqual(2_000);
    expect(withoutReserve.omittedPaths).toEqual(['README.md']);
    expect(withReserve.includedPaths).toEqual(['README.md']);
    expect(withReserve.omittedPaths).toEqual(['src/big.ts']);
  });

  it('fits docs beyond the reserve into budget the source leaves', () => {
    // Arrange
    const base = repo.commit({
      'docs/a.md': '',
      'docs/b.md': '',
      'src/a.ts': '',
    });
    const head = repo.commit({
      'docs/a.md': 'Alpha paragraph.\n'.repeat(10),
      'docs/b.md': 'Beta paragraph.\n'.repeat(10),
      'src/a.ts': 'export const a = 2;\n',
    });
    const changeSet = collectChangeSet(repo.git, base, head, NO_DOCS_GLOBS);

    // Act: the reserve holds one doc; the total holds everything.
    const diff = boundDiff(repo.git, changeSet, {
      totalBytes: 10_000,
      perFileBytes: 5_000,
      docsReserveBytes: 250,
      prioritySources: [],
    });

    // Assert: source is listed first, then docs.
    expect(diff.includedPaths).toEqual(['src/a.ts', 'docs/a.md', 'docs/b.md']);
    expect(diff.omittedPaths).toEqual([]);
  });

  it('includes priority source before other source when the budget is short', () => {
    // Arrange
    const base = repo.commit({ 'apps/cli/flags.ts': '', 'lib/util.ts': '' });
    const head = repo.commit({
      'apps/cli/flags.ts': 'export const flag = 1;\n'.repeat(40),
      'lib/util.ts': 'export const util = 1;\n'.repeat(40),
    });
    const changeSet = collectChangeSet(repo.git, base, head, NO_DOCS_GLOBS);

    // Act: alphabetically `apps/` comes first, so prioritize `lib/`.
    const diff = boundDiff(repo.git, changeSet, {
      totalBytes: 1_200,
      perFileBytes: 1_100,
      docsReserveBytes: 0,
      prioritySources: ['lib/**'],
    });

    // Assert
    expect(diff.includedPaths).toEqual(['lib/util.ts']);
    expect(diff.omittedPaths).toEqual(['apps/cli/flags.ts']);
  });

  it('reads patches and generated attributes from a subdirectory working directory', () => {
    // Arrange
    const base = repo.commit({
      '.gitattributes': 'gen/** linguist-generated\n',
      'src/a.ts': 'export const a = 1;\n',
      'gen/out.ts': 'export const out = 1;\n',
      'sub/keep.txt': 'x\n',
    });
    const head = repo.commit({
      'src/a.ts': 'export const a = 2;\n',
      'gen/out.ts': 'export const out = 2;\n',
    });
    const git = createGit(join(repo.dir, 'sub'));

    // Act
    const changeSet = collectChangeSet(git, base, head, NO_DOCS_GLOBS);
    const diff = boundDiff(git, changeSet, {
      totalBytes: 10_000,
      perFileBytes: 5_000,
      docsReserveBytes: 0,
      prioritySources: [],
    });

    // Assert
    expect(
      changeSet.files.find((entry) => entry.path === 'gen/out.ts')?.category,
    ).toBe('generated');
    expect(diff.text).toContain('+export const a = 2;');
  });

  it('fits a doc larger than the reserve into budget the source leaves', () => {
    // Arrange
    const base = repo.commit({ 'docs/big.md': '', 'src/a.ts': '' });
    const head = repo.commit({
      'docs/big.md': 'A long paragraph of guidance.\n'.repeat(30),
      'src/a.ts': 'export const a = 2;\n',
    });
    const changeSet = collectChangeSet(repo.git, base, head, NO_DOCS_GLOBS);

    // Act: the doc (~1 KB) is over the reserve but under the total.
    const diff = boundDiff(repo.git, changeSet, {
      totalBytes: 10_000,
      perFileBytes: 5_000,
      docsReserveBytes: 200,
      prioritySources: [],
    });

    // Assert
    expect(diff.includedPaths).toEqual(['src/a.ts', 'docs/big.md']);
    expect(diff.omittedPaths).toEqual([]);
  });
});
