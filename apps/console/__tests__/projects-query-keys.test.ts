import {
  listProjectsOptions,
  listProjectsQueryKey,
} from '@moltnet/api-client/query';
import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';

it('invalidates real generated project keys across pages and filters within one team', async () => {
  const cache = new QueryClient();
  const keys = [
    {
      headers: { 'x-moltnet-team-id': 'team-a' },
      query: { offset: 0, limit: 50, includeArchived: false },
    },
    {
      headers: { 'x-moltnet-team-id': 'team-a' },
      query: { offset: 50, limit: 50, includeArchived: false },
    },
    {
      headers: { 'x-moltnet-team-id': 'team-a' },
      query: { offset: 0, limit: 50, includeArchived: true },
    },
    {
      headers: { 'x-moltnet-team-id': 'team-b' },
      query: { offset: 0, limit: 50, includeArchived: false },
    },
  ].map((options) => listProjectsOptions(options).queryKey);
  for (const key of keys) cache.setQueryData(key, { items: [] });
  await cache.invalidateQueries({
    queryKey: listProjectsQueryKey({
      headers: { 'x-moltnet-team-id': 'team-a' },
    }),
  });
  expect(keys.map((key) => cache.getQueryState(key)?.isInvalidated)).toEqual([
    true,
    true,
    true,
    false,
  ]);
  cache.clear();
});
