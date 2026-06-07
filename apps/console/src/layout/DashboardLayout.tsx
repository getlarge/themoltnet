import { useTheme } from '@themoltnet/design-system';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'wouter';

import { useIsMobile, useIsTablet } from '../hooks/useIsMobile.js';
import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';

const COLLAPSED_KEY = 'moltnet-sidebar-collapsed';
const MAIN_CONTENT_ID = 'main-content';
const SIDEBAR_ID = 'console-sidebar';

export function DashboardLayout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === 'true',
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [skipFocused, setSkipFocused] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  const effectiveCollapsed = isTablet ? !collapsed : collapsed;

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSED_KEY, String(!prev));
      return !prev;
    });
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    mainRef.current?.focus();
  }, [location]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <a
        href={`#${MAIN_CONTENT_ID}`}
        onFocus={() => setSkipFocused(true)}
        onBlur={() => setSkipFocused(false)}
        style={{
          position: 'fixed',
          left: theme.spacing[3],
          top: skipFocused ? theme.spacing[3] : '-4rem',
          zIndex: 100,
          padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
          borderRadius: theme.radius.md,
          background: theme.color.bg.surface,
          color: theme.color.primary.DEFAULT,
          boxShadow: theme.shadow.lg,
          transition: `top ${theme.transition.fast}`,
        }}
      >
        Skip to main content
      </a>

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
            role="dialog"
            aria-label="Navigation menu"
            aria-modal="true"
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              zIndex: 50,
              height: '100vh',
            }}
          >
            <Sidebar collapsed={false} id={SIDEBAR_ID} />
          </div>
        )
      ) : (
        <Sidebar collapsed={effectiveCollapsed} id={SIDEBAR_ID} />
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
          menuControls={SIDEBAR_ID}
          menuExpanded={isMobile ? mobileOpen : !effectiveCollapsed}
          onMenuClick={
            isMobile ? () => setMobileOpen((p) => !p) : toggleCollapse
          }
          showMenuButton
        />
        <main
          id={MAIN_CONTENT_ID}
          ref={mainRef}
          tabIndex={-1}
          style={{
            flex: 1,
            padding: theme.spacing[6],
            overflow: 'auto',
            maxWidth: 1280,
            margin: '0 auto',
            width: '100%',
            outline: 'none',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
