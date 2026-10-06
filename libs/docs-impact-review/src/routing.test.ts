import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGit } from './git.js';
import { DEFAULT_AGENT_FACING, DEFAULT_DOCS_EXCLUDE } from './review-config.js';
import {
  dropGenericTerms,
  excludeCandidates,
  routeDocs,
  type RoutingMap,
  searchDocsForTerms,
  selectDocs,
} from './routing.js';
import { createTestRepo, type TestRepo } from './test-repo.js';
import type { ChangedFile } from './types.js';

function file(
  path: string,
  category: ChangedFile['category'] = 'source',
): ChangedFile {
  return { path, status: 'modified', additions: 1, deletions: 1, category };
}

const map: RoutingMap = {
  rules: [
    {
      id: 'cli',
      paths: ['apps/cli/src/**'],
      docs: ['docs/reference/cli.md'],
    },
  ],
};

describe('excludeCandidates', () => {
  it('drops routed or README candidates the repository excludes', () => {
    // Arrange
    const candidates = new Map([
      ['vendor/tool/README.md', ['nearest-readme' as const]],
      ['.github/CHANGELOG.md', ['routing-map' as const]],
      ['docs/cli.md', ['routing-map' as const]],
    ]);

    // Act
    // `**` skips dot directories, so the dot changelog is named explicitly.
    excludeCandidates(candidates, [
      '**/CHANGELOG.md',
      '**/.*/**/CHANGELOG.md',
      'vendor/**',
    ]);

    // Assert
    expect([...candidates.keys()]).toEqual(['docs/cli.md']);
  });
});

describe('routeDocs', () => {
  it('routes by map, nearest owning README, and docs changed in the PR', () => {
    // Arrange
    const files = [
      file('apps/cli/src/flags.ts'),
      file('libs/runtime/src/index.ts'),
      file('docs/use/entries.md', 'docs'),
      file('apps/cli/src/flags.test.ts', 'test'),
    ];
    const readmes = new Set(['apps/cli/README.md', 'libs/runtime/README.md']);

    // Act
    const routed = routeDocs(files, map, (path) => readmes.has(path));

    // Assert
    expect(Object.fromEntries(routed.candidates)).toEqual({
      'docs/reference/cli.md': ['routing-map'],
      'apps/cli/README.md': ['nearest-readme'],
      'libs/runtime/README.md': ['nearest-readme'],
      'docs/use/entries.md': ['changed-in-pr'],
    });
    expect(routed.unroutedSources).toEqual([]);
  });

  it('reports source files with no map rule and no owning README', () => {
    // Arrange
    const files = [file('tools/src/script.ts')];

    // Act
    const routed = routeDocs(files, map, () => false);

    // Assert
    expect(routed.unroutedSources).toEqual(['tools/src/script.ts']);
  });
});

describe('selectDocs', () => {
  it('ranks changed docs and map hits first and reports overflow', () => {
    // Arrange
    const candidates = new Map([
      ['a/README.md', ['nearest-readme' as const]],
      ['docs/changed.md', ['changed-in-pr' as const]],
      ['docs/mapped.md', ['routing-map' as const]],
      ['docs/found.md', ['symbol-search' as const]],
    ]);

    // Act
    const selection = selectDocs(candidates, 3, []);

    // Assert
    expect(selection.selected.map((doc) => doc.path)).toEqual([
      'docs/changed.md',
      'docs/mapped.md',
      'docs/found.md',
    ]);
    expect(selection.overflow).toEqual([
      { path: 'a/README.md', reasons: ['nearest-readme'] },
    ]);
  });
});

describe('selectDocs agent-facing ranking', () => {
  it('ranks user docs above agent skills with the same match', () => {
    // Arrange
    const candidates = new Map([
      ['.agents/skills/x/SKILL.md', ['symbol-search' as const]],
      ['docs/use/x.md', ['symbol-search' as const]],
      ['apps/x/README.md', ['nearest-readme' as const]],
    ]);

    // Act
    const selection = selectDocs(candidates, 2, DEFAULT_AGENT_FACING);

    // Assert
    expect(selection.selected.map((doc) => doc.path)).toEqual([
      'docs/use/x.md',
      'apps/x/README.md',
    ]);
  });

  it('keeps an agent skill the PR itself changed', () => {
    // Act
    const selection = selectDocs(
      new Map([
        ['.agents/skills/x/SKILL.md', ['changed-in-pr' as const]],
        ['docs/use/x.md', ['symbol-search' as const]],
      ]),
      1,
      DEFAULT_AGENT_FACING,
    );

    // Assert
    expect(selection.selected[0].path).toBe('.agents/skills/x/SKILL.md');
  });
});

describe('dropGenericTerms', () => {
  it('drops terms matching too many files and keeps specific ones', () => {
    // Arrange
    const hits = new Map<string, string[]>();
    for (let i = 0; i < 10; i += 1) hits.set(`docs/p${i}.md`, ['--help']);
    hits.set('docs/p0.md', ['--help', 'MOLTNET_SECRET_GUARD']);

    // Act
    const result = dropGenericTerms(hits, 8);

    // Assert
    expect(result.generic).toEqual(['--help']);
    expect(Object.fromEntries(result.hits)).toEqual({
      'docs/p0.md': ['MOLTNET_SECRET_GUARD'],
    });
  });
});

describe('searchDocsForTerms', () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('finds exact terms in markdown at the head revision only', () => {
    // Arrange
    repo.commit({ 'docs/old.md': 'uses --legacy-flag\n' });
    const head = repo.commit({
      'docs/cli.md': 'Pass `--dry-run` to preview.\n',
      'CHANGELOG.md': 'added --dry-run\n',
      'src/cli.ts': 'const flag = "--dry-run";\n',
    });

    // Act
    const { hits } = searchDocsForTerms(repo.git, head, ['--dry-run', 'x'], {
      include: [],
      exclude: DEFAULT_DOCS_EXCLUDE,
    });

    // Assert
    expect(Object.fromEntries(hits)).toEqual({
      'docs/cli.md': ['--dry-run'],
    });
  });

  it('skips Markdown matching the repository exclusions', () => {
    // Arrange
    const head = repo.commit({
      'docs/cli.md': 'Pass `--dry-run` to preview.\n',
      'vendor/tool/README.md': 'Pass `--dry-run` too.\n',
      '.github/CHANGELOG.md': 'added --dry-run\n',
    });

    // Act
    const { hits } = searchDocsForTerms(repo.git, head, ['--dry-run'], {
      include: [],
      exclude: ['**/CHANGELOG.md', '**/.*/**/CHANGELOG.md', 'vendor/**'],
    });

    // Assert: `vendor/**` excludes the directory, and the dot-directory
    // changelog is excluded by the pattern that names the dot.
    expect([...hits.keys()]).toEqual(['docs/cli.md']);
  });

  it('returns nothing when no term matches', () => {
    // Arrange
    const head = repo.commit({ 'docs/cli.md': 'nothing here\n' });

    // Act
    const { hits } = searchDocsForTerms(repo.git, head, ['MOLTNET_NEW_VAR'], {
      include: [],
      exclude: DEFAULT_DOCS_EXCLUDE,
    });

    // Assert
    expect(hits.size).toBe(0);
  });

  it.each([
    ['Markdown only', []],
    ['included formats', ['docs/**/*.rst']],
  ])('searches the whole tree from a subdirectory (%s)', (_label, include) => {
    // Arrange
    const head = repo.commit({
      'docs/cli.md': 'Pass `--dry-run` to preview.\n',
      'sub/notes.md': 'nothing here\n',
    });

    // Act
    const { hits } = searchDocsForTerms(
      createGit(join(repo.dir, 'sub')),
      head,
      ['--dry-run'],
      { include, exclude: [] },
    );

    // Assert
    expect([...hits.keys()]).toEqual(['docs/cli.md']);
  });

  it('matches Markdown extensions in any case, as categorization does', () => {
    // Arrange
    const head = repo.commit({ 'docs/GUIDE.MD': 'Pass `--dry-run`.\n' });

    // Act
    const { hits } = searchDocsForTerms(repo.git, head, ['--dry-run'], {
      include: [],
      exclude: [],
    });

    // Assert
    expect([...hits.keys()]).toEqual(['docs/GUIDE.MD']);
  });

  it('caps included files searched and counts the rest', () => {
    // Arrange: more included files than the cap, every one a match.
    const head = repo.commit({
      'docs/a.rst': '--dry-run\n',
      'docs/b.rst': '--dry-run\n',
      'docs/c.rst': '--dry-run\n',
    });

    // Act
    const search = searchDocsForTerms(
      repo.git,
      head,
      ['--dry-run'],
      { include: ['docs/**/*.rst'], exclude: [] },
      2,
    );

    // Assert
    expect([...search.hits.keys()]).toEqual(['docs/a.rst', 'docs/b.rst']);
    expect(search.unsearched).toBe(1);
  });

  it('searches files the repository includes as documentation', () => {
    // Arrange
    const head = repo.commit({
      'docs/cli.md': 'Pass `--dry-run` to preview.\n',
      'docs/guide/cli.rst': 'Use ``--dry-run`` first.\n',
      'docs/guide/cli.adoc': 'Use `--dry-run` first.\n',
      'docs/vendor/cli.rst': 'Use ``--dry-run`` too.\n',
      'src/cli.ts': 'const flag = "--dry-run";\n',
    });

    // Act: braces are minimatch syntax that git pathspecs do not support.
    const { hits } = searchDocsForTerms(repo.git, head, ['--dry-run'], {
      include: ['docs/**/*.{rst,adoc}'],
      exclude: ['docs/vendor/**'],
    });

    // Assert
    expect([...hits.keys()].sort()).toEqual([
      'docs/cli.md',
      'docs/guide/cli.adoc',
      'docs/guide/cli.rst',
    ]);
  });
});
