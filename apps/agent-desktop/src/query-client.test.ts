import { describe, expect, it } from 'vitest';

import {
  CATALOGUE_RETRIES,
  catalogueRetryDelay,
  createQueryClient,
} from './query-client.js';
import { runCenterKeys } from './run-center/queries.js';

describe('createQueryClient', () => {
  it('retries catalogue reads gently and nothing else', () => {
    // Arrange
    const client = createQueryClient();

    // Act
    const catalogue = client.defaultQueryOptions({
      queryKey: runCenterKeys.catalogue('agent-a'),
    });
    const locations = client.defaultQueryOptions({
      queryKey: ['run-center', 'locations'],
    });

    // Assert
    expect(catalogue.retry).toBe(CATALOGUE_RETRIES);
    expect(catalogue.retryDelay).toBe(catalogueRetryDelay);
    expect(locations.retry).toBe(false);
  });

  it('backs off between catalogue retries without waiting long', () => {
    expect([0, 1, 2, 3].map(catalogueRetryDelay)).toEqual([
      1_000, 2_000, 4_000, 4_000,
    ]);
  });
});
