import { MoltThemeProvider } from '@themoltnet/design-system';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { AuthProvider } from './auth/AuthProvider.js';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <MoltThemeProvider mode="dark">
      <AuthProvider>
        <App />
      </AuthProvider>
    </MoltThemeProvider>
  </StrictMode>,
);
