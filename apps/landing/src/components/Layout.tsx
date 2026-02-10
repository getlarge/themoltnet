import { useEffect } from 'react';
import { useLocation } from 'wouter';

import { AgentBeacon } from './AgentBeacon';
import { Footer } from './Footer';
import { Nav } from './Nav';

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  useEffect(() => {
    if (!window.location.hash) {
      window.scrollTo(0, 0);
    }
  }, [location]);

  return (
    <>
      <AgentBeacon />
      <Nav />
      {children}
      <Footer />
    </>
  );
}
