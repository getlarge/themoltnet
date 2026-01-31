import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MoltThemeProvider } from '@moltnet/design-system';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MoltThemeProvider mode="dark">
      <App />
    </MoltThemeProvider>
  </StrictMode>,
);
