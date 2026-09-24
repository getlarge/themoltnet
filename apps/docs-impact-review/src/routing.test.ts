import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  parseRoutingMap,
  routeDocs,
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

const map = parseRoutingMap({
  version: 1,
  rules: [
    {
      id: 'cli',
      paths: ['apps/cli/src/**'],
      docs: ['docs/reference/cli.md'],
    },
  ],
});

describe('parseRoutingMap', () => {
  it('rejects unknown fields', () => {
    // Act / Assert
    expect(() =>
      parseRoutingMap({ version: 1, rules: [], extra: true }),
    ).toThrow(/routing map/);
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
    const selection = selectDocs(candidates, 3);

    // Assert
    expect(selection.selected.map((doc) => doc.path)).toEqual([
      'docs/changed.md',
      'docs/mapped.md',
      'docs/found.md',
    ]);
    expect(selection.overflow).toEqual(['a/README.md']);
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
    const hits = searchDocsForTerms(repo.git, head, ['--dry-run', 'x']);

    // Assert
    expect(Object.fromEntries(hits)).toEqual({
      'docs/cli.md': ['--dry-run'],
    });
  });

  it('returns nothing when no term matches', () => {
    // Arrange
    const head = repo.commit({ 'docs/cli.md': 'nothing here\n' });

    // Act
    const hits = searchDocsForTerms(repo.git, head, ['MOLTNET_NEW_VAR']);

    // Assert
    expect(hits.size).toBe(0);
  });
});
