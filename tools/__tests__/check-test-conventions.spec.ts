import { describe, expect, it } from 'vitest';

import { findViolations } from '../src/check-test-conventions';

describe('findViolations', () => {
  const sources: Record<string, string> = {
    'libs/a/src/helper.ts': "import { vi } from 'vitest';",
    'libs/a/src/index.ts': 'export const a = 1;',
  };
  const read = (file: string) => sources[file] ?? '';

  it('accepts the target layout', () => {
    // Arrange
    const files = [
      'libs/a/src/index.ts',
      'libs/a/__tests__/index.spec.ts',
      'libs/a/__tests__/fixtures/data.ts',
      'apps/x-e2e/src/flow.e2e.spec.ts',
      'libs/cpp-sdk/tests/client.test.cpp',
      'libs/a/tsconfig.spec.json',
    ];

    // Act & Assert
    expect(findViolations(files, read)).toEqual([]);
  });

  it('reports each deviation', () => {
    // Arrange
    const files = [
      'libs/a/__tests__/old.test.ts',
      'apps/x-e2e/src/flow.e2e.ts',
      'libs/a/src/index.spec.ts',
      'libs/a/src/lib/__tests__/nested.spec.ts',
      'packages/p/tests/plugin.spec.mjs',
      'libs/a/src/helper.ts',
      'libs/a/src/index.ts',
    ];

    // Act
    const violations = findViolations(files, read);

    // Assert
    expect(violations.map((v) => v.file)).toEqual([
      'libs/a/__tests__/old.test.ts',
      'apps/x-e2e/src/flow.e2e.ts',
      'libs/a/src/index.spec.ts',
      'libs/a/src/lib/__tests__/nested.spec.ts',
      'packages/p/tests/plugin.spec.mjs',
      'libs/a/src/helper.ts',
    ]);
  });
});
