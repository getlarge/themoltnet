import { expect, it } from 'vitest';

import { sampleEntries, type SourceEntry } from '../src/capture.js';
const entries: SourceEntry[] = Array.from({ length: 20 }, (_, i) => ({
  id: `source-${i}`,
  title: 'Example',
  content: 'Synthetic content',
  tags: i % 2 ? ['scope:one'] : null,
  entryType: 'semantic',
  createdAt: '2026-01-01T00:00:00Z',
  importance: 5,
}));
it('reproduces a balanced sample independently of enumeration order', () => {
  const result = sampleEntries(entries, 6, 'capture-test');
  expect(sampleEntries([...entries].reverse(), 6, 'capture-test')).toEqual(
    result,
  );
  expect(result.filter((e) => e.tags === null)).toHaveLength(3);
  expect(new Set(result.map((e) => e.id)).size).toBe(6);
  expect(sampleEntries(entries, 50, 'capture-test')).toHaveLength(20);
});
it('rejects duplicate IDs and invalid sampling metadata', () => {
  expect(() => sampleEntries([entries[0], entries[0]], 1, 'seed')).toThrow(
    /Duplicate/,
  );
  expect(() => sampleEntries(entries, 0, 'seed')).toThrow();
  expect(() =>
    sampleEntries([{ ...entries[0], createdAt: 'invalid' }], 1, 'seed'),
  ).toThrow();
});
