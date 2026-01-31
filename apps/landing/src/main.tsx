import './index.css';

import { MoltThemeProvider } from '@moltnet/design-system';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MoltThemeProvider mode="dark">
      <App />
    </MoltThemeProvider>
  </StrictMode>,
);
