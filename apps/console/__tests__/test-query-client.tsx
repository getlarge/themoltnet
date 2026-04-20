import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';

export function createTestWrapper() {
  const queryClient = new QueryClient({
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
