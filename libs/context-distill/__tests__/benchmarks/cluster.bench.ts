import { bench, describe } from 'vitest';

import { cluster } from '../../src/cluster.js';
import type { DistillEntry } from '../../src/types.js';

function randomEntry(id: string, dim = 384): DistillEntry {
  const embedding = Array.from({ length: dim }, () => Math.random() - 0.5);
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  return {
    id,
    embedding: embedding.map((v) => v / norm),
    content: `content-${id}`,
    tokens: 50,
    importance: 5,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

const entries50 = Array.from({ length: 50 }, (_, i) => randomEntry(`e${i}`));
const entries100 = Array.from({ length: 100 }, (_, i) => randomEntry(`e${i}`));
const entries200 = Array.from({ length: 200 }, (_, i) => randomEntry(`e${i}`));
const entries500 = Array.from({ length: 500 }, (_, i) => randomEntry(`e${i}`));

describe('cluster() scaling (O(n³) worst case, 384-dim)', () => {
  bench('50 entries', () => {
    cluster(entries50, { threshold: 0.15 });
  });
  bench('100 entries', () => {
    cluster(entries100, { threshold: 0.15 });
  });
  bench('200 entries', () => {
    cluster(entries200, { threshold: 0.15 });
  });
  bench('500 entries', () => {
    cluster(entries500, { threshold: 0.15 });
  });
});
