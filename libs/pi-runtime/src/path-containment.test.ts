import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isResolvedPathInsideRoot } from './path-containment.js';

describe('isResolvedPathInsideRoot', () => {
  const root = resolve('/workspace');

  it('accepts the root and descendants', () => {
    expect(isResolvedPathInsideRoot(root, root)).toBe(true);
    expect(isResolvedPathInsideRoot(resolve(root, 'src/index.ts'), root)).toBe(
      true,
    );
  });

  it('rejects sibling-prefix and parent paths', () => {
    expect(
      isResolvedPathInsideRoot(resolve('/workspace-other/file'), root),
    ).toBe(false);
    expect(isResolvedPathInsideRoot(resolve(root, '../outside'), root)).toBe(
      false,
    );
  });
});
