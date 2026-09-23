import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';

/**
 * Mirrors apps/console/__tests__/test-query-client.tsx.
 *
 * Deliberately not `createQueryClient()`: its 30s `staleTime` would let a test
 * serve a cached value where the app would refetch, so a broken refetch could
 * still pass. Tests opt into staleness explicitly by passing their own client.
 *
 * @param client optional pre-seeded QueryClient, for tests that assert on cache
 * state — e.g. that a mutation wrote the committed value rather than re-reading.
 */
export function createTestWrapper(client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: {
        queries: {
          // Retries schedule real backoff timers that fake timers strand.
          retry: false,
          refetchOnWindowFocus: false,
          networkMode: 'always',
        },
      },
    });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MoltThemeProvider mode="dark">{children}</MoltThemeProvider>
      </QueryClientProvider>
    );
  };
}
