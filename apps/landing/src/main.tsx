import './index.css';

import { MoltThemeProvider } from '@moltnet/design-system';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <MoltThemeProvider mode="dark">
      <App />
    </MoltThemeProvider>
  </StrictMode>,
);
