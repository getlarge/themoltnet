import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseRoutingMap } from './routing.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const map = parseRoutingMap(
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../docs-routing.json'), 'utf8'),
  ) as unknown,
);

describe('docs-routing.json', () => {
  it('only routes to documentation files that exist', () => {
    // Act
    const missing = map.rules
      .flatMap((rule) => rule.docs)
      .filter((doc) => !existsSync(resolve(repoRoot, doc)));

    // Assert
    expect(missing).toEqual([]);
  });
});
