import { QueryClientProvider } from '@tanstack/react-query';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { AuthProvider } from './auth/AuthProvider.js';
import { queryClient } from './query-client.js';
import { TeamProvider } from './team/TeamProvider.js';

const storedTheme = localStorage.getItem('moltnet-theme') as
  | 'dark'
  | 'light'
  | 'system'
  | null;

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <MoltThemeProvider mode={storedTheme ?? 'system'}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TeamProvider>
            <App />
          </TeamProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MoltThemeProvider>
  </StrictMode>,
);
