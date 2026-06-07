import { useTheme } from '@themoltnet/design-system';
import { type ReactNode, useCallback, useState } from 'react';

import { useIsMobile, useIsTablet } from '../hooks/useIsMobile.js';
import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';

const COLLAPSED_KEY = 'moltnet-sidebar-collapsed';

export function DashboardLayout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === 'true',
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  const effectiveCollapsed = isTablet ? !collapsed : collapsed;

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSED_KEY, String(!prev));
      return !prev;
    });
  }, []);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Mobile drawer overlay */}
      {isMobile && mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            border: 0,
            padding: 0,
            zIndex: 40,
          }}
        />
      )}

      {/* Sidebar */}
      {isMobile ? (
        mobileOpen && (
          <div
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              zIndex: 50,
              height: '100vh',
            }}
          >
            <Sidebar collapsed={false} />
          </div>
        )
      ) : (
        <Sidebar collapsed={effectiveCollapsed} />
      )}

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <Header
          onMenuClick={
            isMobile ? () => setMobileOpen((p) => !p) : toggleCollapse
          }
          showMenuButton
        />
        <main
          style={{
            flex: 1,
            padding: theme.spacing[6],
            overflow: 'auto',
            maxWidth: 1280,
            margin: '0 auto',
            width: '100%',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
