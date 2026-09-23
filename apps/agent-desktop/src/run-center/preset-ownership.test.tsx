/**
 * Why presets are local state rather than a query.
 *
 * Issue #2420 proposed moving presets to `useMutation` with the list updated
 * in `onSuccess`. That works for the happy path, but presets have a specific
 * requirement from the #2394 review: a committed write must not be able to
 * become a failed save through a second read. The test below shows Query
 * cannot express that — `setQueryData` does not reach an observer whose query
 * is in an error state, so a write after a failed read is invisible.
 *
 * Project locations have no such requirement and are a query.
 */
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('writing to a query that failed to read', () => {
  it('does not reach the observer, so presets cannot be a query', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const read = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValue(new Error('storage unavailable'));
    let seen: string[] | undefined;
    function Reader() {
      seen = useQuery({ queryKey: ['presets'], queryFn: read }).data;
      return null;
    }
    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <Reader />
        </QueryClientProvider>,
      );
    });
    expect(seen).toBeUndefined();

    await act(async () => {
      client.setQueryData(['presets'], ['committed']);
    });

    // The cache holds the write...
    expect(client.getQueryData(['presets'])).toEqual(['committed']);
    // ...but the component still renders nothing, which for presets would mean
    // a save the user completed disappearing from the list.
    expect(seen).toBeUndefined();
  });
});
