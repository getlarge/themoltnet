import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseLabels } from './score.js';

describe('labels.json', () => {
  it('is valid and every label explains itself', () => {
    // Act
    const labels = parseLabels(
      JSON.parse(
        readFileSync(resolve(import.meta.dirname, '../labels.json'), 'utf8'),
      ) as unknown,
    );

    // Assert
    expect(Object.keys(labels.prs).length).toBeGreaterThan(0);
  });
});
