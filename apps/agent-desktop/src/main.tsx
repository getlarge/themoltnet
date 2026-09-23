import './styles.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import {
  createQueryClient,
  installWindowFocusTracking,
} from './query-client.js';
import { DesktopRunCenter } from './run-center/DesktopRunCenter.js';
import { tauriWindowFocus } from './window-focus.js';

const root = document.getElementById('root');
if (!root) throw new Error('MoltNet Agent renderer root is missing');

// Before the client, so the first query observes a correct focus state.
installWindowFocusTracking(tauriWindowFocus());
const queryClient = createQueryClient();

createRoot(root).render(
  <StrictMode>
    <MoltThemeProvider mode="system">
      <QueryClientProvider client={queryClient}>
        <DesktopRunCenter />
      </QueryClientProvider>
    </MoltThemeProvider>
  </StrictMode>,
);
