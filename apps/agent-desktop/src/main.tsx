import './styles.css';

import { MoltThemeProvider } from '@themoltnet/design-system';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('MoltNet Agent renderer root is missing');

createRoot(root).render(
  <StrictMode>
    <MoltThemeProvider mode="system">
      <App />
    </MoltThemeProvider>
  </StrictMode>,
);
