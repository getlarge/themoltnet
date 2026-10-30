import { describe, expect, it } from 'vitest';

import { SOURCE_TEST_FILE_PATTERN } from '../../../generators/split-tsconfigs/index';

describe('SOURCE_TEST_FILE_PATTERN', () => {
  it.each([
    ['src/foo.spec.ts', true],
    ['libs/lib/src/lib/foo.spec.tsx', true],
    ['src/foo.spec.mjs', true],
    ['src/foo.test.ts', false],
    ['__tests__/foo.spec.ts', false],
    ['src/foo.ts', false],
  ])('%s → %s', (file, expected) => {
    // Act & Assert
    expect(SOURCE_TEST_FILE_PATTERN.test(file)).toBe(expected);
  });
});
