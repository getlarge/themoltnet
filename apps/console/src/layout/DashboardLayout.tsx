import { useTheme } from '@themoltnet/design-system';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';

const COLLAPSED_KEY = 'moltnet-sidebar-collapsed';
const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

export function DashboardLayout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === 'true',
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    function check() {
      const w = window.innerWidth;
      setIsMobile(w < MOBILE_BREAKPOINT);
      setIsTablet(w >= MOBILE_BREAKPOINT && w < TABLET_BREAKPOINT);
    }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const effectiveCollapsed = isMobile || isTablet ? true : collapsed;

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
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
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
          showMenuButton={isMobile || !isTablet}
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
