import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';

/**
 * @param client optional pre-seeded QueryClient, for tests that assert on cache
 * state — e.g. that a mutation invalidated one query and spared another.
 */
export function createTestWrapper(client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnWindowFocus: false,
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
