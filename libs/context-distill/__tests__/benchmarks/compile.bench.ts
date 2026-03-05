import { bench, describe } from 'vitest';

import { compile } from '../../src/compile.js';
import type { DistillEntry } from '../../src/types.js';

function randomEntry(id: string, tokens: number, dim = 384): DistillEntry {
  const embedding = Array.from({ length: dim }, () => Math.random() - 0.5);
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  const content = Array.from(
    { length: Math.ceil(tokens * 0.75) },
    (_, i) => `word${i}`,
  ).join(' ');
  return {
    id,
    embedding: embedding.map((v) => v / norm),
    content,
    tokens,
    importance: 5,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

const entries50 = Array.from({ length: 50 }, (_, i) =>
  randomEntry(`e${i}`, 200),
);
const entries100 = Array.from({ length: 100 }, (_, i) =>
  randomEntry(`e${i}`, 200),
);
const query = Array.from({ length: 384 }, () => Math.random() - 0.5);

describe('compile() — MMR + budget fitting (384-dim)', () => {
  bench('50 entries, budget 8000, no task prompt', () =>
    compile(entries50, { tokenBudget: 8000 }),
  );
  bench('50 entries, budget 8000, with task prompt', () =>
    compile(entries50, { tokenBudget: 8000, taskPromptEmbedding: query }),
  );
  bench('100 entries, budget 8000, no task prompt', () =>
    compile(entries100, { tokenBudget: 8000 }),
  );
  bench('100 entries, tight budget 500', () =>
    compile(entries100, { tokenBudget: 500 }),
  );
});
