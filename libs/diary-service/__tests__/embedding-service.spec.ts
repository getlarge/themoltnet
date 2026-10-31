import { describe, expect, it } from 'vitest';

import { createNoopEmbeddingService } from '../src/embedding-service.js';

describe('NoopEmbeddingService', () => {
  const service = createNoopEmbeddingService();

  it('embedPassage returns empty array', async () => {
    const result = await service.embedPassage('hello world');
    expect(result).toEqual([]);
  });

  it('embedQuery returns empty array', async () => {
    const result = await service.embedQuery('search query');
    expect(result).toEqual([]);
  });

  it('returns consistent empty arrays', async () => {
    const a = await service.embedPassage('text1');
    const b = await service.embedPassage('text2');
    expect(a).toEqual(b);
  });
});
