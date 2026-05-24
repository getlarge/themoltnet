import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { MapApp } from './MapApp.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root container for the diary map app.');
}

createRoot(container).render(
  <StrictMode>
    <MapApp />
  </StrictMode>,
);
