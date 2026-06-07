import { useTheme } from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';

import { AgentBeacon } from './AgentBeacon';
import { Footer } from './Footer';
import { Nav } from './Nav';

export function Layout({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const [location] = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [skipFocused, setSkipFocused] = useState(false);

  useEffect(() => {
    if (!window.location.hash) {
      window.scrollTo(0, 0);
    }
    mainRef.current?.focus();
  }, [location]);

  return (
    <>
      <AgentBeacon />
      <a
        href="#main-content"
        onFocus={() => setSkipFocused(true)}
        onBlur={() => setSkipFocused(false)}
        style={{
          position: 'fixed',
          left: theme.spacing[4],
          top: skipFocused ? theme.spacing[4] : '-4rem',
          zIndex: theme.zIndex.modal,
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
      <Nav />
      <main id="main-content" ref={mainRef} tabIndex={-1}>
        {children}
      </main>
      <Footer />
    </>
  );
}
