import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { createTokenCacheRedisClient } from '../src/bootstrap.js';

describe('token-cache Redis client', () => {
  it('gives token commands a bounded wait on a separate connection', () => {
    // Arrange
    const tokenClient = {} as Redis;
    const duplicate = vi.fn().mockReturnValue(tokenClient);
    const shared = { duplicate } as unknown as Redis;

    // Act
    const result = createTokenCacheRedisClient(shared);

    // Assert
    expect(result).toBe(tokenClient);
    expect(duplicate).toHaveBeenCalledExactlyOnceWith({
      connectionName: 'rest-api-oauth-cache',
      commandTimeout: 250,
    });
  });
});
