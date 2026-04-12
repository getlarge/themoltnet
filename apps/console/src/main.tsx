import { MoltThemeProvider } from '@themoltnet/design-system';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { AuthProvider } from './auth/AuthProvider.js';
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
      <AuthProvider>
        <TeamProvider>
          <App />
        </TeamProvider>
      </AuthProvider>
    </MoltThemeProvider>
  </StrictMode>,
);
