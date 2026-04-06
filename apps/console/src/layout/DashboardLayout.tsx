/**
 * DashboardLayout — Main layout shell with sidebar, header, and content area.
 */

import type { ReactNode } from 'react';

import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';

export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Header />
        <main style={{ flex: 1, padding: '1.5rem', overflow: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
