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
  const [tabletExpanded, setTabletExpanded] = useState(false);
  const [skipFocused, setSkipFocused] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const mobileDialogRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  const effectiveCollapsed = isTablet ? !tabletExpanded : collapsed;

  const toggleCollapse = useCallback(() => {
    if (isTablet) {
      setTabletExpanded((expanded) => !expanded);
      return;
    }
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSED_KEY, String(!prev));
      return !prev;
    });
  }, [isTablet]);

  useEffect(() => {
    setMobileOpen(false);
    mainRef.current?.focus();
  }, [location]);

  useEffect(() => {
    if (!isMobile || !mobileOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const dialog = mobileDialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusable()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
        window.setTimeout(() => {
          document
            .querySelector<HTMLElement>(`[aria-controls="${SIDEBAR_ID}"]`)
            ?.focus();
        });
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [isMobile, mobileOpen]);

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

      {isMobile && mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: theme.color.black,
            border: 0,
            opacity: 0.64,
            padding: 0,
            zIndex: 40,
          }}
        />
      )}

      {isMobile ? (
        mobileOpen && (
          <div
            ref={mobileDialogRef}
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
        aria-hidden={isMobile && mobileOpen ? true : undefined}
        inert={isMobile && mobileOpen ? true : undefined}
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
            padding: isMobile ? theme.spacing[4] : theme.spacing[6],
            overflow: 'auto',
            maxWidth: theme.layout.contentMax,
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
